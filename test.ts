
import { assertEquals, assert, assertThrows, assertRejects } from "https://deno.land/std@0.112.0/testing/asserts.ts";

Deno.env.set('ENV', 'testing');

// Address for the tests' local servers to listen.
const LOCAL_HOST = 'http://localhost/'

import { App, post, get, all, Args } from './src/mod.ts';

Deno.test('App.constructor: Should allow registering routes', async () => {
    const app = new App();
    app.post('/foo', ({ res }) => res.status(500).end());
    await app.start();
    const { status }  = await app.trigger('post', '/foo');
    assertEquals(status, 500)
    await app.stop();
});

Deno.test('App.constructor: Should store any settings sent', () => {
    const app = new App({ conf: { key: 'value' } });
    assertEquals(app.conf.key, 'value');
});

Deno.test('App.start: Should start the http server when port sent', async () => {
    const app = new App({ conf: { port: 80 } });
    await app.start();
    const { status, body } = await fetch(LOCAL_HOST);
    assertEquals(status, 404)
    await body?.cancel()
    await app.stop();
});

Deno.test('App.start: Should prevent starting a running server', async () => {
    const app = new App();
    await app.start();
    assertEquals(await app.start(), 'running');
    await app.stop();
});

Deno.test('App.start: Should trigger before start event', async () => {
    let done = false;
    const app = new App({ startup: () => { done = true } });
    await app.start();
    assert(done);
    await app.stop();
});


Deno.test('App.stop: Should stop the http server', async function(){
    const app = new App({ conf: { port: 80 } });
    await app.start();
    await app.stop();
    await assertRejects(() => fetch(LOCAL_HOST));
});

Deno.test('App.stop: Should trigger after stop event', async () => {
    let done = false;
    const app = new App({ shutdown: () => { done = true } });
    await app.start();
    await app.stop();
    assert(done);
});

Deno.test('App.stop: Should not fail when calling close sucessively', async () => {
    const app = new App();
    await app.start();
    await app.stop();
    await app.stop();
});

Deno.test('App.restart: Should take down the sever and bring it back up', async function() {
    const app = new App({ conf: { port: 80 } });
    await app.start();

    const r = await fetch(LOCAL_HOST)
    assertEquals(r.status, 404)
    await r.body?.cancel()

    await app.restart();

    const r1 = await fetch(LOCAL_HOST)
    assertEquals(r1.status, 404)
    await r1.body?.cancel()

    await app.stop();
});

Deno.test('App.restart: Should reload conf when new object is sent', async () => {
    const app = new App();
    await app.start();
    await app.restart({ myKey: 3 });
    assertEquals(app.conf.myKey, 3);
    await app.stop();
});

Deno.test('App.setup: Should apply settings on top of existing one', () => {
    const app = new App({ conf: { key: 'value' } });
    app.setup({ key: 'value2', key2: 'value' });
    assertEquals(app.conf.key, 'value2');
    assertEquals(app.conf.key2, 'value');
});

Deno.test('App.trigger: Should trigger route without http server', async () => {
    const app = new App({ conf: { port: 80 } });
    app.post('/foo', ({ res }) => res.status(202).text('Test'))
    app.post('/nores', ({ res }) => res.status(204).end())
    await app.start();
    await app.trigger('post', '/nores');
    const res = await app.trigger('post', '/foo');
    assertEquals(res.status, 202);
    assertEquals(await res.body, 'Test');
    await app.stop();
});

Deno.test('App.trigger: Should default to response status to 200', async () => {
    const app = new App({ conf: { port: 80 } });
    app.post('/foo', ({ res }) => {
        res.set('X-Test', 'Foo');
        res.end();
    })
    app.post('/bar', ({ res }) => {
        res.append('X-Test', 'Foo');
        res.end();
    })
    await app.start();
    const r = await app.trigger('post', '/bar');
    assertEquals(r.status, 200);
    assertEquals(r.headers['x-test'], 'Foo');
    const res = await app.trigger('post', '/foo', { headers: { host: 'what.com' } });
    assertEquals(res.headers['x-test'], 'Foo');
    await app.stop();
});


Deno.test('App.trigger: Should properly parse body inputs', async () => {

    const app = new App({
        conf: { port: 80 },
        routes: [
            post('/raw', async ({ body, res }) => {
                const input = await body.raw();
                const str = new TextDecoder().decode(input);
                assertEquals(str, '12345');
                res.end();
            }),

            post('/json', async ({ body, res }) => {
                const input = await body.json();
                assertEquals(input, 12345);
                res.end();
            }),

            post('/text', async ({ body, res }) => {
                const input = await body.text();
                assertEquals(input, '12345');
                res.end();
            })
        ]
    });
    await app.start();

    const r1 = await app.trigger('post', '/raw', { body: '12345' });
    assertEquals(r1.status, 200);
    const r2 = await app.trigger('post', '/json', { body: '12345', headers: { 'content-type': 'application/json' } });
    assertEquals(r2.status, 200);
    const r3 = await app.trigger('post', '/text', { body: '12345', headers: { 'content-type': 'text/css' } });
    assertEquals(r3.status, 200);

    await app.stop();
});

Deno.test('App.call: Should call any user func with route handler args', async () => {

    function userFunc(this: App, { conf }: App, arg1: string){
        assertEquals(arg1, 'foo');
        assertEquals(conf.bar, 'baz');
        assert(this instanceof App);
    }

    const app = new App({
        conf: { bar: 'baz' },
        startup({ call }){
            call(userFunc, 'foo');
        }
    });
    await app.start();
    await app.stop();
});

Deno.test('Handlers: Should pass all the required args to handler', async () => {
    const app = new App({
        conf: { port: 80 },
        routes: [
            get('/foo', function(obj){
                assert(obj.res && obj.body && obj.params && obj.query
                    && obj.conf && obj.log);
                assert(this instanceof App);
                obj.res.end();
            }),
        ]
    });
    await app.start();
    const { status, body } = await fetch(LOCAL_HOST + 'foo')
    assertEquals(status, 200)
    body?.cancel();
    await app.stop();
});

Deno.test('Handlers: Should execute \'all\' handler on any path/method', async () => {
    const app = new App({
        conf: { port: 80 },
        routes: [
            all(({ res, path }) => {
                res.type('text/plain')
                res.end(path)
            })
        ]
    });
    await app.start();
    assertEquals((await app.trigger('post', '/foo/bar')).body, '/foo/bar');
    assertEquals((await app.trigger('get', '/')).body, '/');
    await app.stop();
});

Deno.test('Handlers: Should pass all present parameters to handler', async () => {
    const app = new App({
        conf: { port: 80 },
        routes: [
            get('/fo/:o', () => {}),
            get('/foo/:bar', ({ params, res }) => {
                res.badRequest(params.bar !== 'test');
                res.end();
            })
        ]
    });
    await app.start();
    const { status, body } = await fetch(LOCAL_HOST + 'foo/test')
    assertEquals(status, 200)
    body?.cancel()
    await app.stop();
});

Deno.test('Handlers: Should parse URL query string', async () => {
    const app = new App({
        conf: { port: 80 },
        routes: [
            post('/foobar', ({ query, res }) => {
                assertEquals(query.foo, 'bar');
                res.end();
            }),
        ]
    });
    await app.start();
    const { status, body } = await fetch(LOCAL_HOST + 'foobar?foo=bar', { method: 'post' });
    assertEquals(status, 200);
    body?.cancel()
    await app.stop();
});

Deno.test('Handlers: Should output a 404 when no route is found for a given path', async () => {
    const app = new App({ conf: { port: 80 } });
    await app.start();
    const { status, body } = await fetch(LOCAL_HOST + 'foobar', { method: 'post' });
    assertEquals(status, 404);
    body?.cancel()
    await app.stop();
});

Deno.test('Handlers: Should parse object as json response [res.json()]', async () => {
    const app = new App({
        conf: { port: 80 },
        routes: [
            get('/foo', function({ res }){
                res.json('{"hey":"ho"}');
            }),
        ]
    });
    await app.start();
    const { headers, body } = await fetch(LOCAL_HOST + 'foo')
    assertEquals(headers.get('content-type'), 'application/json');
    body?.cancel()
    await app.stop();
});

Deno.test('Handlers: Should set multiple cookies properly', async function(){

    const app = new App({
        conf: { port: 80 },
        routes: [
            get('/foo', function({ res }){
                res.cookie('test', 'foo');
                res.cookie('testa', 'bar');
                res.cookie('testa', 'baz');
                res.end();
            }),
        ]
    });
    await app.start();
    const { headers, body } = await fetch(LOCAL_HOST + 'foo');
    assert(headers.get('set-cookie')?.includes('testa=bar; Path=/'));
    body?.cancel()
    await app.stop();
});

// Deno.test('Handlers: Should set encrypted (signed) cookies', async function(){
//     const app = new App({
//         conf: { port: 80, cookie: { secret: 'OH YEAH' } },
//         routes: [

//             get('/foo', function({ res }){
//                 res.cookie('test', 'foo', { signed: true, maxAge: 5000  });
//                 res.cookie('testa', 'bar');
//                 res.end();
//             }),

//             get('/bar', function({ res, cookies, signedCookies }){
//                 res.badRequest(cookies.testa !== 'bar');
//                 res.badRequest(signedCookies.test !== 'foo');
//                 res.end();
//             }),
//         }
//     });
//     await app.start();
//     const { cookies } = await fetch(LOCAL_HOST + 'foo');
//     // let { status } = await base.get('bar', { cookies });
//     assertEquals(status, 200);
//     await app.stop();
// });

// Deno.test('Handlers: Should fail when trying to sign cookies without a secret', async function(){
//     const app = new App({
//         conf: { port: 80 },
//         routes: [
//             get('/foo', function({ res }){
//                 res.cookie('test', 'foo', { signed: true });
//             }),
//         }
//     });
//     await app.start();
//     const { status } = await fetch(LOCAL_HOST + 'foo');
//     assertEquals(status, 500)
//     await app.stop();
// });

// Deno.test('Handlers: Should not read cookies with wrong signature', async function(){
//     const app = new App({
//         conf: { port: 80, cookie: { secret: 'OH YEAH' } },
//         routes: [
//             get('/foo', function({ res }){
//                 res.cookie('test', 'foo', { signed: true, maxAge: 5000  });
//                 res.end();
//             }),

//             get('/bar', function({ res, signedCookies }){
//                 res.badRequest(signedCookies.test !== 'foo');
//                 res.end();
//             }),
//         }
//     });
//     await app.start();
//     let { cookies } = await fetch(LOCAL_HOST + 'foo');
//     cookies['test'] = cookies['test'].substring(0, cookies['test'].length - 1) + '1';
//     // let { status } = await fetch(LOCAL_HOST + 'bar': { cookies });
//     assertEquals(status, 400);
//     await app.stop();
// });

Deno.test('Handlers: Should clear cookies', async function(){
    const app = new App({
        conf: { port: 80 },
        routes: [

            get('/foo', function({ res }){
                res.cookie('testa', 'bar');
                res.end();
            }),

            get('/bar', function({ res, headers }){
                res.badRequest(!headers['cookie']);
                res.clearCookie('testa');
                res.end();
            }),
        ]
    });
    await app.start();
    const { headers, body } = await fetch(LOCAL_HOST + 'foo');
    body?.cancel()
    const { status, headers: hs, body: b1 } = await fetch(LOCAL_HOST + 'bar', {
        headers: new Headers({ 'cookie': headers.get('set-cookie') ?? '' })
    });
    b1?.cancel()
    assert(status == 200);
    assert((hs.get('set-cookie') ?? '').indexOf('Expires') > -1);
    await app.stop();
});

Deno.test('Handlers: Should call any user func with route handler args', async () => {

    function userFunc(this: App, { path }: Args, arg1: string){
        assertEquals(arg1, 'foo', );
        assertEquals(path, '/foo');
        assert(this instanceof App);
    }

    const app = new App({
        conf: { bar: 'baz' },
        routes: [
            post('/foo', function({ call, res }){
                call(userFunc, 'foo', 'faa');
                res.end();
            }),
        ]
    });
    await app.start();
    const { status } = await app.trigger('post', '/foo');
    assertEquals(status, 200);
    await app.stop();
});


Deno.test('Body Parsing: Should send 400 when failed to parse body', async () => {
    const app = new App({
        conf: { port: 80 },
        routes: [
            post('/foobar', async ({ body }) => { await body.json() })
        ]
    });
    await app.start();
    const { status, body }  = await fetch(LOCAL_HOST + 'foobar', {
        method: 'post',
        headers: { 'Content-Type': 'application/json' },
        body: 'foobar}'
    })
    assertEquals(status, 400)
    body?.cancel()
    await app.stop();
});

Deno.test('Body Parsing: Should not parse request body when setup so', async () => {
    const app = new App({
        conf: { port: 80 },
        routes: [
            post('/foobar', ({ body, res }) => {
                assertEquals(body.constructor.name, 'RequestBody');
                res.end();
            }),
        ]
    });
    await app.start();
    const { status, body }  = await fetch(LOCAL_HOST + 'foobar', {
        method: 'post',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: 'foo=bar'
    })
    assertEquals(status, 200)
    body?.cancel()
    await app.stop();
});


Deno.test('Assertions: Should throw when condition evaluates to true', async () => {
    const app = new App({
        conf: { port: 80 },
        routes: [
            get('/foo', function({ res }){
                // assertThrows( () => res.badRequest(true, Buffer.from('abc')) );
                assertThrows( () => res.unauthorized(true) );
                assertThrows( () => res.forbidden(true) );
                assertThrows( () => res.notFound(true) );
                assertThrows( () => res.conflict(true) );
                assertThrows( () => res.gone(true) );
                res.end();
            }),
        ]
    });
    await app.start();
    const { body } = await fetch(LOCAL_HOST + 'foo');
    body?.cancel()
    await app.stop();
});

Deno.test('Assertions: Should do nothing when condition evaluates to false', async () => {
    const app = new App({
        conf: { port: 80 },
        routes: [
            get('/foo', function({ res }){
                res.badRequest(false);
                res.unauthorized(false);
                res.forbidden(false);
                res.notFound(false);
                res.conflict(false);
                res.gone(false);
                res.end();
            }),
        ]
    });
    await app.start();
    const { status, body } = await fetch(LOCAL_HOST + 'foo');
    assert(status == 200);
    body?.cancel()
    await app.stop();
});


Deno.test('Error Handling: Should handle Error thrown sync on the route', async () => {
    const app = new App({
        conf: { port: 80 },
        routes: [
            post('/unknown', () => {
                throw new Error('othererr');
            }),
        ]
    });
    await app.start();
    const { status, body } = await fetch(LOCAL_HOST + 'unknown', { method: 'post' });
    assertEquals(status, 500);
    body?.cancel()
    await app.stop();
});

Deno.test('Error Handling: Should handle Error injected sync on the route', async () => {
    const app = new App({
        conf: { port: 80 },
        routes: [
            post('/known', ({ res }) => {
                throw res.error(404);
            }),
            post('/unknown', ({ res }) => {
                throw res.error(new Error('errfoobar'));
            }),
            post('/serverfault', ({ res }) => {
                throw res.error(501, { test: 'foo' });
            }),
        ]
    });
    await app.start();
    const { status, body } = await fetch(LOCAL_HOST + 'known', { method: 'post' });
    body?.cancel()
    assertEquals(status, 404);
    const { status: s2, body: b2 } = await fetch(LOCAL_HOST + 'unknown', { method: 'post' });
    b2?.cancel()
    assertEquals(s2, 500);
    const { status: s3, body: b3 } = await fetch(LOCAL_HOST + 'serverfault', { method: 'post' });
    b3?.cancel()
    assertEquals(s3, 501);
    await app.stop();
});

Deno.test('Error Handling: Should handle Rejection on async route', async () => {
    const app = new App({
        conf: { port: 80 },
        routes: [
            post('/async', async () => {
                await new Promise((_y, n) => n());
            }),
        ]
    });
    await app.start();
    const { status, body } = await fetch(LOCAL_HOST + 'async', { method: 'post' });
    assertEquals(status, 500)
    body?.cancel()
    await app.stop();
});

Deno.test('Error Handling: Should handle Error injected ASYNC on the route', async () => {
    const app = new App({
        conf: { port: 80 },
        routes: [
            post('/known', ({ res }) => {
                setTimeout(function(){
                    res.error(404, true);
                }, 10)
            }),
            post('/unknown', ({ res }) => {
                setTimeout(function(){
                    res.error({ a: 'b' });
                }, 10)
            }),
            // post('/unknown/object', ({ res }) => {
            //     res.error(Buffer.from('abc'));
            // },
        ]
    });
    await app.start();
    const { status, body } = await fetch(LOCAL_HOST + 'known', { method: 'post' });
    assertEquals(status, 404);
    body?.cancel()
    const { status: s2, body: b2 } = await fetch(LOCAL_HOST + 'unknown', { method: 'post' });
    b2?.cancel()
    assertEquals(s2, 500);
    // const { status: s3, body: b3 } = await fetch(LOCAL_HOST + 'unknown/object', { method: 'post' });
    // b3.cancel()
    // assertEquals(s3, 500);
    await app.stop();
});

Deno.test('Regression: Should handle errors even when error event has no listeners', async () => {
    const app = new App({
        conf: { port: 80 },
        routes: [
            post('/bar', () => {
                throw new Error('errfoobar');
            }),
        ]
    });
    await app.start();
    const { status, body } = await fetch(LOCAL_HOST + 'bar', { method: 'post' });
    assertEquals(status, 500);
    body?.cancel()
    await app.stop();
});

Deno.test('Regression: Should not fail when attempting to close during startup', async () => {
    const app = new App();
    const p = app.start();
    await app.stop();
    await p;
    await app.stop();
});

Deno.test('Regression: Should not fail when attempting to start during shutdown', async function(){
    const app = new App({
        async shutdown() {
            await new Promise(done => setTimeout(done, 1200));
        }
    });
    await app.start();
    const p = app.stop();
    await app.start();
    await p;
});

Deno.test('Regression: Should not modify the very object used as cookie options', async () => {
    const cookieOpts = { maxAge: 68300000 };
    const app = new App({
        conf: { port: 80 },
        routes: [
            get('/foo', function({ res }){
                res.cookie('test', 'foo', cookieOpts);
                res.cookie('testa', 'bar', cookieOpts);
                res.json(cookieOpts);
            })
        ]
    });
    await app.start();
    const r = await fetch(LOCAL_HOST + 'foo');
    assertEquals((await r.json()).maxAge, 68300000);
    await app.stop();
});

Deno.test('Regression: Should NOT send reponse body when assertion has no message', async () => {
    const app = new App({
        conf: { port: 80 },
        routes: [
            get('/foo', function({ res }){
                res.unauthorized(true);
            })
        ]
    });
    await app.start();
    const r = await fetch(LOCAL_HOST + 'foo');
    assert(!r.headers.get('content-type'));
    assertEquals((await r.text()).length, 0);
    await app.stop();
});

Deno.test('Regression: Should not crash on weird json body', async () => {

    const app = new App({
        conf: { port: 80 },
        routes: [
            post('/foobar', async function({ body }){
                await body.json();
            })
        ]
    });
    await app.start();

    const { status, body } = await fetch(LOCAL_HOST + 'foobar', {
        method: 'post',
        headers: { 'Content-Type': 'application/json' },
        body: '{"sdf:'
    })
    assertEquals(status, 400);
    body?.cancel()
    await app.stop();
});

Deno.test('Regression: Should keep proper app state when errors happen at startup and shutdown', async () => {
    let app = new App({
        startup(){
            throw new Error('foo');
        }
    });
    await assertRejects(() => app.start(), undefined, 'foo');

    app = new App({
        shutdown(){
            throw new Error('foo');
        }
    });
    await app.start();
    await assertRejects(() => app.stop(), undefined, 'foo');
});

Deno.test('CORS: Should send permissive CORS headers when setup so [cors]', async () => {
    const app = new App({
        conf: { cors: {}, port: 80 },
        routes: [
            get('/foobar', ({ res }) => res.end())
        ]
    });
    await app.start();

    const { status, headers, body } = await fetch(LOCAL_HOST + 'foobar', {
        headers: { 'Origin': 'http://outsider.com' }
    });
    body?.cancel()

    assertEquals(status, 200)
    assert(headers.get('access-control-allow-origin') == '*');

    const { headers: h2, body: b2 } = await fetch(LOCAL_HOST + 'foobar', {
        method: 'OPTIONS',
        headers: { 'Origin': 'http://outsider.com' }
    });

    b2?.cancel()

    assert(h2.get('access-control-allow-methods') == 'GET,HEAD,PUT,PATCH,POST,DELETE');
    await app.stop();
});

Deno.test('Should not send CORS headers when setup so [cors]', async () => {
    const app = new App({
        conf: { port: 80 },
        routes: [
            get('/foobar', ({ res }) => res.end())
        ]
    });
    await app.start();

    const { status, headers, body } = await fetch(LOCAL_HOST + 'foobar', {
        headers: { 'Origin': 'http://outsider.com' }
    });
    body?.cancel()

    assertEquals(status, 200)
    assert(!headers.get('access-control-allow-origin'));
    await app.stop();
});

Deno.test('Should store data to be accessible to all handlers [app.global]', async () => {

    type Global = {
        foo: string
    }

    const app = new App({
        conf: { port: 80 },
        routes: [
            post<Global>('/bar', ({ foo, res }) => {
                res.text(foo);
            })
        ]
    });
    await app.start();
    app.global.foo = 'foobar';
    const r = await fetch(LOCAL_HOST + 'bar', { method: 'post' });
    assertEquals(await r.text(), 'foobar');
    await app.stop();
});
