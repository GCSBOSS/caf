
// const { buildWebSocketServer } = require('./ws');
// import WebSocket from 'ws'

import confort from './conf.ts'
import API from './api.ts'
import { Obj, Route, ConfObject, RouteHandler, ResponseData, getDataTypeFromContentType, parseBuffer } from './types.ts'
import Logger from './logger.ts'
import { assert } from "https://deno.land/std@0.160.0/testing/asserts.ts";
import { readAll, readerFromStreamReader } from "https://deno.land/std@0.160.0/streams/conversion.ts";


type AppOpts<T extends Obj = Obj> = {
    /** An array with your api endpoints */
    routes?: Route<T>[],
    /** A function to run whenever the app is starting */
    startup?: (args: App<T>) => Promise<void> | void,
    /** A function to run whenever the app is stopping */
    shutdown?: (args: App<T>) => Promise<void> | void,
    /** App name, mainly used in log entries */
    name?: string,
    /** App version, mainly used in log entries */
    version?: string,
    /** Default config object or file path */
    conf?: ConfObject | string,
    /** Whether to handle websocket upgrade requests. Defaults to `false`. */
    websocket?: boolean
}

function retryShortly<T>(fn: () => Promise<T>): Promise<T>{
    return new Promise(done => setTimeout(() => fn().then(done), 1000));
}

const normalizePath = (p: string) => (p.slice(-1) == '/' ? p.slice(0, -1) : p) || '/';

/** Define a POST endpoint to `path` that when triggered will run the `handler` function */
export function post<T extends Obj = Obj>(path: string, handler: RouteHandler<T>): Route<T>{
    return { method: 'POST', handler, path }
}

/** Define a PUT endpoint to `path` that when triggered will run the `handler` function */
export function put<T extends Obj = Obj>(path: string, handler: RouteHandler<T>): Route<T>{
    return { method: 'PUT', handler, path }
}

/** Define a PATCH endpoint to `path` that when triggered will run the `handler` function */
export function patch<T extends Obj = Obj>(path: string, handler: RouteHandler<T>): Route<T>{
    return { method: 'PATCH', handler, path }
}

/** Define a GET endpoint to `path` that when triggered will run the `handler` function */
export function get<T extends Obj = Obj>(path: string, handler: RouteHandler<T>): Route<T>{
    return { method: 'GET', handler, path }
}

/** Define a DELETE endpoint to `path` that when triggered will run the `handler` function */
export function del<T extends Obj = Obj>(path: string, handler: RouteHandler<T>): Route<T>{
    return { method: 'DELETE', handler, path }
}

/** Define a fallback `handler` function to be triggered when there are no matching routes */
export function all<T extends Obj = Obj>(handler: RouteHandler<T>): Route<T>{
    return { handler, all: true, method: 'ALL', path: '*' }
}

/**
 * A light RESTful App
 *
 * Example usage:
 * ```js
 * const app = new App({
 *     api({ get }){
 *         get('/foo', function({ res }){
 *             res.text('bar');
 *         });
 *     }
 * });
 * await app.start();
 * const { status, body } = await app.trigger('get', '/bar');
 * console.log(status, body);
 * await app.stop();
 * ```
 */
export class App<T extends Obj = Obj> {

    private state: 'standby' | 'stopping' | 'stuck' | 'running' | 'starting'

    /** A user controlled object whose properties wil be spread in route handler args. */
    global: T
    /** The current app configuration. */
    conf: ConfObject
    /** A logging utility to output JSON lines to stdout. */
    log!: Logger
    /** Call `fn` with the app global args as the first parameter and spreading `args`. */
    call: <T, Y>(fn: (app: this, ...args: Y[]) => T, ...args: Y[]) => T


    // private _websocket = opts.websocket;
    private _startup?: (args: App<T>) => Promise<void> | void
    private _shutdown?: (args: App<T>) => Promise<void> | void
    private _api: API<T>
    private _name: string
    private _version: string;
    private _conns: Deno.HttpConn[] = [];
    private _server?: Deno.Listener;

    /**
     * Creates a new instance of an app in standby.
     */
    constructor(opts?: AppOpts<T>){
        opts = opts ?? {};

        // this._websocket = opts.websocket;
        this._startup = opts.startup;
        this._shutdown = opts.shutdown;

        this._name = opts.name ?? 'untitled';
        this._version = opts.version ?? '0.0.0';

        assert(!opts.startup || typeof this._startup == 'function',
            'Startup handler must be a function');

        assert(!opts.shutdown || typeof this._shutdown == 'function',
            'Shutdown handler must be a function');

        this.call = (fn, ...args) => fn.call(this, { ...this.global, ...this }, ...args);

        this.conf = {};
        this.state = 'standby';

        this.global = {} as T
        this.setup(opts.conf ?? {});

        this._api = new API(this);
        opts.routes?.forEach(r => r.all
            ? this._api.setFallbackRoute(r.handler)
            : this._api.addEndpoint(r.method.toLowerCase(), r.path, r.handler));
    }

    /**
     * Run a standby app. The returned `Promise` is resolved after the startup is
     * complete.
     */
    async start(): Promise<'running' | 'starting'>{

        if(this.state in { running: 1, starting: 1 })
            return this.state as 'running' | 'starting';
        if(this.state == 'stopping')
            return await retryShortly(() => this.start());

        this.state = 'starting';

        this.global = {} as T;

        if(this._startup)
            this.log.debug({ type: 'app' }, 'Starting up %s...', this._name);

        // Handle exceptions in user code to maintain proper app state
        try{
            await this._startup?.(this);
        }
        catch(err){
            this.state = 'stuck';
            await this.stop().catch(() => {});
            throw err;
        }

        if(this.conf.port)
            this.startServer();
        else
            this.log.info({ type: 'app' }, '%s v%s has started', this._name, this._version);

        return this.state = 'running';
    }

    /**
     * Stop a running app. The returned `Promise` is resolved after the shutdown
     * is complete.
     */
    async stop(): Promise<'standby' | 'stopping'>{
        if(this.state in { stopping: 1, standby: 1 })
            return this.state as 'standby' | 'stopping';

        if(this.state == 'starting')
            return await retryShortly(() => this.stop());

        this.state = 'stopping';

        this._server?.close();
        this._conns.map(a => a.close());
        await new Promise(a => setTimeout(_ => a(true), 0))

        // Handle exceptions in user code to maintain proper app state
        try{
            await this._shutdown?.(this);
        }
        catch(err){
            throw err;
        }
        finally{
            this.global = {} as T;
            this.log.info({ type: 'app' }, 'Stopped');
            this.state = 'standby';
        }

        return this.state;
    }

    /**
     * Restart a running app, applying configuration if sent. The returned
     * `Promise` is resolved once the app is fully started up.
     */
    async restart(conf?: ConfObject | string): Promise<void>{
        await this.stop();
        if(typeof conf == 'object'){
            this.log.debug({ type: 'app' }, 'Reloaded settings');
            this.setup(conf);
        }
        await this.start();
    }

    /**
     * Apply configuration from an object or reading from a config file in one
     * of the supported formats (JSON, TOML, YAML).
     */
    setup(...conf: (ConfObject | string)[]): void {
        this.conf = confort(this.conf, ...conf);

        this.conf.log = this.conf.log ?? {};
        if(this.conf.log)
            this.conf.log.defaults = { app: this._name };
        this.log = new Logger(this.conf.log);
    }

    /**
     * Trigger an app endpoint with given input data. Returns a `Promise`
     * resolving to the normalized response data.
     */
    async trigger(method: string, path: string, input?: {
        body?: BodyInit,
        headers?: Record<string, string>,
        query?: Record<string, string>,
        cookies?: Record<string, string>
    }): Promise<ResponseData>{
        input = input ?? {};

        const r = new Request('http://0.0.0.0', {
            body: input.body,
            method
        })

        const res = this._api.trigger({
            headers: new Headers(input.headers),
            path,
            method: method.toUpperCase(),
            query: input.query ?? {},
            body: r
        });

        await res.sent;

        let bodyObject: unknown;

        const ct = res.headersObj.get('content-type') ?? '';
        if(ct){
            const { type, charset } = getDataTypeFromContentType(ct);
            const reader = readerFromStreamReader(res.stream.getReader());
            bodyObject = parseBuffer(await readAll(reader), type, charset);
        }

        return {
            status: res.statusCode,
            headers: Object.fromEntries(res.headersObj.entries()),
            body: bodyObject ?? res.stream
        };
    }

    private startServer(){

        this._server = Deno.listen({ port: this.conf.port! });

        this.log.info({ type: 'server' },
            '%s v%s is ready on port %s', this._name, this._version, this.conf.port);

        (async() => {
            for await (const conn of this._server!){

                (async() => {

                    const httpConn = Deno.serveHttp(conn);
                    this._conns.push(httpConn);
                    for await (const reqEvent of httpConn) {

                        const req = reqEvent.request;
                        const url = new URL(req.url);
                        const method = req.method.toUpperCase();
                        const res = this._api.trigger({
                            path: normalizePath(url.pathname),
                            query: Object.fromEntries(new URLSearchParams(url.search).entries()),
                            body: req,
                            headers: req.headers,
                            method,
                            ip: (conn?.remoteAddr as Deno.NetAddr).hostname
                        });

                        res.sent.then(() => reqEvent.respondWith(new Response(
                            method == 'OPTIONS' || method == 'HEAD' ? undefined : res.stream,
                            { status: res.statusCode, headers: res.headersObj }
                        )));
                    }
                })();

            }

        })();

        // if(this._websocket)
        //     this._wss = buildWebSocketServer(this);
    }


    /** Define a POST endpoint to `path` that when triggered will run the `handler` function */
    post(path: string, handler: RouteHandler<T>){
        this._api.addEndpoint('POST', path, handler);
    }

    /** Define a PUT endpoint to `path` that when triggered will run the `handler` function */
    put(path: string, handler: RouteHandler<T>){
        this._api.addEndpoint('POST', path, handler);
    }

    /** Define a PATCH endpoint to `path` that when triggered will run the `handler` function */
    patch(path: string, handler: RouteHandler<T>){
        this._api.addEndpoint('POST', path, handler);
    }

    /** Define a GET endpoint to `path` that when triggered will run the `handler` function */
    get(path: string, handler: RouteHandler<T>){
        this._api.addEndpoint('POST', path, handler);
    }

    /** Define a DELETE endpoint to `path` that when triggered will run the `handler` function */
    del(path: string, handler: RouteHandler<T>){
        this._api.addEndpoint('POST', path, handler);
    }

    /** Define a fallback `handler` function to be triggered when there are no matching routes */
    all(handler: RouteHandler<T>){
        this._api.setFallbackRoute(handler);
    }

}
