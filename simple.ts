
Deno.test('App.start: Should start the http server when port sent', async () => {

const server = Deno.listen({ port: 80 });

(async function(){

    for await(const conn of server){

        (async function(){
            const httpConn = Deno.serveHttp(conn);

            for await(const reqEvent of httpConn){
                (async function(){


                    await reqEvent.respondWith(new Response('res.stream', {
                        status: 200
                    }));

                })();
            }


        })();

    }

})();

const res = await fetch('http://localhost');
await res.text()


console.log("before close");
server.close();
console.log("after close");

await new Promise(a => setTimeout(_ => a(true), 0))
console.log("after wait");

// setTimeout(()=>{
    const newServer = Deno.listen({ port: 80 });

    newServer.close();

console.log("done");


// }, 2000)
});
