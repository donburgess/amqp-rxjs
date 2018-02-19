# AMQP-RXJS
This project creates a wrapper around the amqplib library that supports: 
- Listening to queues
- Sending messages to queues
- Setting up a remote procedure call (RPC) server
- Pushing to a RPC while waiting for a response.

## Please Observe
All messages are converted into a JSON string for safely parsing back to a JSON object from a buffer. What this means to you is that so long as you use this library to send messages you should not have any problem parsing them. If you try to send a message outside this library then you need to be sure that you are sending JSON.stringify objects in order to avoid JSON.parse exceptions.

## Creating A Connection
This library contains a class intended to encapsulate a single connection with support for multiple channels. There are two methods for creating a connection:
- \#connect
- \#connectAutoRetry

### Connect
Calling this method will return an observable that will emit the first channel created after getting connected. If either connecting or creating the channel fails then an error will be emitted instead.

If you try to call \#connect while a connection is opened it will attempt to close the open connection first.

Sample Typescript *'...' represents ambigious code that will depend on your own usage:
```
import { AMQP } from '@db3dev/amqp-rxjs'

const amqp = new AMQP({...});
amqp.connect().subscribe(
    // Function called when connection has been successful
    (channel) => console.log('Connected via AMQP!')
    
    // Catch function
    (error) => console.error(`Connection Failed...\n${error.stack}`);
);
```

### Connect Auto Retry
\#connectAutoRetry performs the same actions as the previous \#connect method but will attempt to connect again after 10 seconds if the attempt failed.

Sample Typescript *'...' represents ambigious code that will depend on your own usage:
```
import { AMQP } from '@db3dev/amqp-rxjs'

const amqp = new AMQP({...});
amqp.connectAutoRetry().subscribe(
    // Function called when connection has been successful
    (channel) => console.log('Connected via AMQP!')
    
    // Catch function
    (error) => console.error(`Failed to create channel...\n${error.stack}`);
);
```

### Closing The Connection
You can also manually close the class's connection.
```
import { AMQP } from '@db3dev/amqp-rxjs'

const amqp = new AMQP({...});
amqp.connect().switchMap(() => amqp.closeConnection()).subscribe();
```

## Channels
Each instantiated class has one connection, a default channel but also stores a collection of any additional channels in a hashmap.

### Create A New Channel
\#createChannel will use the current connection to create a channel. An error will be thrown if a connection does not already exist. Specifying a key will make the new channel retreivable.

```
import { AMQP } from '@db3dev/amqp-rxjs'

const amqp = new AMQP({...});
amqp
    .connect()
    .switchMap(() => amqp.createConnection('two'))
    .subscribe(
        (key) => console.log(!!amqp.getChannel(key))
        // calling getChannel with no parameters retreives the default channel.
    );
```

### Closing A Channel
\#closeChannel will close an open channel. Throws an error if the channel could not be retreived.

```
import { AMQP } from '@db3dev/amqp-rxjs'

const amqp = new AMQP({...});
amqp
    .connect()
    .switchMap(() => amqp.createConnection('two'))
    .switchMap((key) => amqp.closeConnection(key))
    .subscribe(
        (key) => console.log(!!amqp.getChannel(key))
        // calling getChannel with no parameters retreives the default channel.
    );
```

## Listening To A Queue
\#listenQueue<T> will create a subject that will emit the message sent to a specified queue. The queue subjects are ReplaySubjects. This means when you subscribe to them you will get every message the subject has received during the time subscribed to the queue in order of earliest to latest.

```
import { AMQP } from '@db3dev/amqp-rxjs'

const amqp = new AMQP({...});
amqp
    .connect()
    .subscribe(() => init());

function init () {
    amqp.listenQueue<string>('SendMeStrings').subscribe(
        (msg) => console.log(msg);
    );

    amqp.listenQueue<{msg: string}>('SendMeWrappedStrings').subscribe(
        (msg) => console.log(msg.msg)
    );
}
```

## Sending To A Queue
\#sendToQueue will send a message to a specified queue.

```
import { AMQP } from '@db3dev/amqp-rxjs'

const amqp = new AMQP({...});
amqp
    .connect()
    .subscribe(() => init());

function init () {
    amqp.sendToQueue('SendMeStrings', 'Here is a string!').subscribe(
        (success) => console.log(success),
        (failure) => console.error(failure)
    );

    amqp.sendToQueue('SendMeWrappedStrings', {msg: 'Here is a wrapped string!').subscribe(
        (success) => console.log(success),
        (failure) => console.error(failure)
    );
    
    amqp.listenQueue<string>('SendMeStrings').subscribe(
        (msg) => console.log(msg);
    );

    amqp.listenQueue<{msg: string}>('SendMeWrappedStrings').subscribe(
        (msg) => console.log(msg.msg)
    );
}
```

## Remote Procedure Call (RPC)
The RPC makes use of node event emitters and correlationIds to effeciently and effectively send/receive messages. The Rx library provides a very efficent means of publishing and subscribing asynchronously.

### Sending A RPC Message
\#sendRPC<T>, where T being the type you expect to get back, will send a message to a designated queue. If that message is received by a RPC listener it will have the means it needs to be able to send a processed response back.

To send RPC messages, RPC must initially be enabled by the #\enableRPCSend method.

```
import { AMQP } from '@db3dev/amqp-rxjs'

const amqp = new AMQP({...});
amqp
    .connect()
    .switchMap(() => amqp.enableRPCSend())
    .subscribe(() => init());

function init () {
    amqp.sendRPC<string>('rpcQueue', {action: 'process', payload: 'aaa'}).subscribe(
        (response) => console.log(response),
        (error) => console.error(error)
    );
}
```

### Setting Up A RPC Listener
\#listenRPC will receive messages from a specified queue and then process each message through a specified function. The function signature specifically needs to take in the message as a parameter and a callback function. When the process is over pass the response to the callback method to be sent back.

```
import { AMQP } from '@db3dev/amqp-rxjs'

const amqp = new AMQP({...});
amqp
    .connect()
    .switchMap(() => amqp.enableRPCSend())
    .subscribe(() => init());

function init () {
    amqp.sendRPC<string>('rpcQueue', {action: 'process', payload: 'aaa'}).subscribe(
        (response) => console.log(response),
        (error) => console.error(error)
    );

    amqp.listenRPC('rpcQueue', (message, cb) => {
        console.log(message.payload);
        cb('thank you for the payload');
    });
}
```