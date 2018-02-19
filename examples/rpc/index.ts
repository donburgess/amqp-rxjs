import { AMQP } from '@db3dev/amqp-rxjs';
import { Observable } from 'rxjs';

const amqp: AMQP = new AMQP({
    hostname: 'localhost'
});

amqp
    .connectAutoRetry()
    .switchMap(() => amqp.enableRPCSend())
    .subscribe(
        (r) => init(),
        (error) => console.error(error)
    );

function init() {
    amqp.listenRPC('rpcQueue', (msg: {payload: string}, cb: Function) => {
        console.log(`receiver got: ${msg.payload}`)

        cb(msg.payload.toLowerCase());
    }).subscribe();
    
    amqp.sendRPC<string>('rpcQueue', {payload:'THIS IS ALL UPPERCASED'}).subscribe(
        (response) => console.log(`sender received: ${response}`),
        (err) => console.error(err)
    );
}