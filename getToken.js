const { authenticate } = require('@google-cloud/local-auth');
const path = require('path');

const SCOPES = ['https://www.googleapis.com/auth/fitness.activity.read'];

async function getRefreshToken() {
    const client = await authenticate({
        keyfilePath: path.join(process.cwd(), 'credentials.json'),
        scopes: SCOPES
    });

    console.log(client.credentials.refresh_token);
}

getRefreshToken();
