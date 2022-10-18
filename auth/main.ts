
import { connect } from "https://deno.land/x/redis/mod.ts";
import { App } from '../src/mod.ts';
import { router } from './routes.ts';

const app = new App({

    routes: router.routes,

    async startup({ global }){



        global.redis = await connect({
            hostname: "127.0.0.1",
            port: 6379,
        })





    }

})



app.start();