import Logger from './logger.ts';
import { App } from './app.ts';
import CafResponse from './response.ts';

export type Dictionary = Record<string, unknown>;
export type Obj = Record<never, never>;

import { CorsOptions } from './cors.ts';
import { RequestBody } from './body.ts';

export type ConfObject = {
    /** Controls logging output. */
    log?: {
        /** Define fields to be added to all log entries */
        defaults?: Dictionary,
        /** Only output log entries with specified `level` or above */
        level?: 'debug' | 'info' | 'warn' | 'error' | 'fatal',
        /** Only output log entries matching any `type` */
        only?: string | string[],
        /** Only output log entries not matching any `type` */
        except?: string | string[]
    },
    /** Creates an HTTP server that will be managed on the given port. */
    port?: number,

    cors?: CorsOptions
} & Dictionary

export type RouteHandlerArgs<T extends Obj = Obj> = {
    /** Object containing request headers as key-values. */
    headers: Record<string, string>,
    /** Object containing request URL query string as key-values. */
    query: Record<string, string>,
    /** A logging utility to output JSON lines to stdout. */
    log: Logger,
    /** Request body object (in case `opts.autoParseBody` is `true`, will contain the parsed data instead). */
    body: RequestBody/* | unknown*/,
    /** Request URL path. */
    path: string,
    /** Request HTTP method. */
    method: string,
    /** Response object used to compose a response to the client. */
    res: CafResponse,
    /** Call `fn` with the request handler args as the first parameter and spreading `args`. */
    call: <Y, Z>(fn: (input: RouteHandlerArgs<T>, ...args: Y[]) => Z, ...args: Y[]) => Z
    /** The current app configuration. */
    conf: ConfObject,
    /** Object containing the request unsigned cookies as key-values. */
    cookies: Record<string, string>,
    /** Object containing the request signed cookies as key-values. */
    // signedCookies: Record<string, string>,
    /** Object containing params parsed from URL segments as key-values. */
    params: Record<string, string>
    /** The remote address of the client performing the request. Standard proxy headers are considered. */
    ip: string,
    /** Accept WebSocket connection on upgrade. Only available when `opts.websocket` is set. */
    // websocket: () => Promise<WebSocket.WebSocket>
} & T


export type RouteHandler<T extends Obj = Obj> = (this: App<T>, input: RouteHandlerArgs<T>) => Promise<void> | void

export type Route<T extends Obj = Obj> = {
    /** Endpoint HTTP method */
    method: string,
    /** Endpoint path starting with slash (e.g `/foo/:bar`) */
    path: string,
    /** Function to be called when endpoint is triggered */
    handler: RouteHandler<T>,

    all?: boolean
}

export interface ReqInfo {
    method: string,
    path: string,
    host?: string | null,
    agent?: string | null
}

export type ResponseData = {
    status: number,
    headers: Record<string, string>,
    body: unknown
}

import { Buffer } from "https://deno.land/std@0.133.0/io/mod.ts";

export function getContentTypeFromDataType(data: unknown): string | undefined{
    if(data == '' || data == null || typeof data == 'undefined' || data instanceof Buffer || data instanceof ArrayBuffer)
        return;
    if(typeof data == 'object')
        return 'application/json';
    return 'text/plain';
}

type DataType = {
    type?: string,
    charset?: string
}

export function getDataTypeFromContentType(contentType: string): DataType{
    const charset = contentType?.match(/charset=([^;]+)/)?.[1];
    if(contentType?.slice(0, 16) == 'application/json')
        return { type: 'json', charset: charset ?? 'utf-8' };
    if(contentType?.slice(0, 33) == 'application/x-www-form-urlencoded')
        return { type: 'text', charset: charset ?? 'ascii' };
    if(contentType?.slice(0, 5) == 'text/' || charset)
        return { type: 'text', charset };
    return {};
}

export function parseBuffer(buffer: ArrayBuffer, type?: string, charset?: string): unknown {

    if(type == 'json' || type == 'text'){
        const string = new TextDecoder(charset).decode(buffer);
        if(type == 'json')
            return JSON.parse(string);
        if(type == 'text')
            return string;
    }

    return buffer;
}