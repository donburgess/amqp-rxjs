import * as amqplib from 'amqplib';
import * as uuid from 'uuid';
import * as dns from 'dns';
import { Observable, ReplaySubject } from 'rxjs';
import { EventEmitter } from 'events';

const REPLY_QUEUE = 'amq.rabbitmq.reply-to';
const DEFAULT = 'default';

export class AMQP {
    private _connection: amqplib.Connection;
    private _client: amqplib.Channel;
    private _clients: {[key: string]: amqplib.Channel} = {};
    private _rpcEvents: EventEmitter;
    private readonly _defaultConsumeOpts: amqplib.Options.Consume;
    private readonly _defaultAssertOpts: amqplib.Options.AssertQueue;

    constructor(private readonly _config: amqplib.Options.Connect, chOpts: amqplib.Options.AssertQueue = {}, coOpts: amqplib.Options.Consume = {noAck: true}) {
        this._defaultConsumeOpts = coOpts;
        this._defaultAssertOpts = chOpts;
    }

    public connectAutoRetry(attempt = 0): Observable<string> {
        // return this.closeConnection()
        console.log(`AMQP Connection Attempt: ${attempt}`);
        return Observable.of({})
            .switchMap(() => Observable
                .fromPromise(amqplib.connect(this._config))
                .catch(() => Observable.interval(10000).take(1).switchMap(() => {
                    console.log(`AMQP Connection Attempt Failed.`)
                    return this.connectAutoRetry(++attempt)
                }))
                .switchMap((connection: amqplib.Connection) => {
                    this._connection = connection;
                    return this.createChannel(DEFAULT).map((channel) => {
                        this._client = this.getChannel(DEFAULT)
                        return channel;
                    });
                })
            );
    }

    public connect(): Observable<string> {
        // return this.closeConnection()
        return Observable.of({})
            .switchMap(() => Observable
                .fromPromise(amqplib.connect(this._config))
                .switchMap((connection: amqplib.Connection) => {
                    this._connection = connection;
                    return this.createChannel(DEFAULT).map((channel) => {
                        this._client = this.getChannel(DEFAULT)
                        return channel;
                    });
                })
            );
    }
    
    public createChannel(key: string, connection = this._connection): Observable<string> {
        if (!connection) {
            return Observable.throw(new Error('Not currently connected.'));
        }

        if (!key || this._clients[key]) {
            return Observable.throw(new Error('Provide a unique key to create with this channel.'));
        }
        
        return Observable
            .fromPromise(connection.createChannel())
            .map((channel: amqplib.Channel) => {
                this._clients[key] = channel;
                return key;
            });
    }

    public closeConnection(): Observable<void> {
        if (this._connection) {
            return Observable.fromPromise(this._connection.close());
        } else {
            return Observable.of();
        }
        
    }
    public closeChannel(key: string): Observable<string> {
        const channel = this._clients[key];
        if (!channel) {
            return Observable.throw(new Error('Channel could not be found'));
        } else {
            return Observable
                .fromPromise(channel.close())
                .map(() => key);
        }
    }

    public listenRPC(queueName: string, procedure: (msg: any, callback: (response: any, error?: Error) => void) => void, queueOptions = this._defaultAssertOpts, channel = this._client): Observable<amqplib.Replies.Consume> {
        if (!channel) {
            return Observable.throw(new Error('An open channel is required to consume messages.'));
        }

        return Observable.concat(
            channel.assertQueue(queueName, queueOptions),
            channel.consume(
                queueName,
                (msg: amqplib.Message) => {
                    const decodedMsg = msg.content.toString();

                    procedure(JSON.parse(decodedMsg), (response, error?: Error) => {
                        // Verify a response is prepared
                        if(!response && !error) {
                            error = new Error('RPC Failed To Produce a Response');
                        }

                        // Prepare outgoing message
                        let outgoing: string;
                        if (error) {
                            if (response) {
                                error = Object.assign(error, {response});
                            }

                            outgoing = JSON.stringify(error);
                        } else {
                            outgoing = JSON.stringify(response);
                        }

                        // Respond with message
                        channel.sendToQueue(
                            msg.properties.replyTo,
                            new Buffer(outgoing),
                            { correlationId: msg.properties.correlationId }
                        )
                    });

                    channel.ack(msg);
                }
            ),
            (assert: amqplib.Replies.AssertQueue, consume: amqplib.Replies.Consume) => consume
        );
    }

    public enableRPCSend(channel = this._client): Observable<amqplib.Replies.Consume> {
        if (this._rpcEvents) {
            return Observable.of();
        }
        // Create listener for RPC Events
        this._rpcEvents = new EventEmitter();
        
        // Consume responses
        return Observable.fromPromise(
            channel.consume(
                REPLY_QUEUE,
                (msg: amqplib.Message) => {
                    this._rpcEvents.emit(msg.properties.correlationId, msg.content)
                },
                { noAck: true }
            )
        );
    }

    public sendRPC<T>(queueName: string, message: any, channel = this._client, events = this._rpcEvents): Observable<T> {
        if (!channel) {
            return Observable.throw(new Error('An open channel is required to send messages.'));
        }

        if (!events) {
            return Observable.throw(new Error('Enable RPC Sending Before Attempting to Send an RPC request.'));
        }

        // Create RPC Send Event
        return Observable.fromPromise(
            new Promise((resolve, reject) => {
                // Prepare for response
                const correlationId = uuid.v4();
                events.once(correlationId, resolve);

                // Send message
                const outgoing = JSON.stringify(message);
                channel.sendToQueue(queueName, new Buffer(outgoing), { correlationId, replyTo: REPLY_QUEUE })
            })
            .then((response: Buffer) => JSON.parse(response.toString()))
        );
    }

    public listenQueue<T>(queueName: string, consumeOpts: amqplib.Options.Consume = this._defaultConsumeOpts, assertOpts: amqplib.Options.AssertQueue = this._defaultAssertOpts, channel = this._client): Observable<T> {
        const subject = new ReplaySubject<string>();

        Observable.concat(
            channel.assertQueue(queueName, assertOpts),
            channel.consume(
                queueName,
                (msg: amqplib.Message) => {
                    subject.next(msg.content.toString())
                },
                consumeOpts
            )
        ).subscribe();
        
        return subject.asObservable().map((msg) => JSON.parse(msg));
    }

    public sendToQueue(queueName: string, message: any, consumeOpts: amqplib.Options.Consume = this._defaultConsumeOpts, channel = this._client): Observable<boolean> {
        const outgoing = JSON.stringify(message);

        return Observable.of(
            channel.sendToQueue(queueName, new Buffer(outgoing), consumeOpts)
        );
    }

    public get connection() {
        return this._connection;
    }

    public getChannel(channel = DEFAULT) {
        return this._clients[channel];
    }
}