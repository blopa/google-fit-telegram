const { authenticate } = require('@google-cloud/local-auth');
const path = require('path');
const scopes = require('./scopes');

const SCOPES = scopes;

async function getRefreshToken() {
    const client = await authenticate({
        keyfilePath: path.join(process.cwd(), 'credentials.json'),
        scopes: SCOPES,
        expires_in: 0,
    });

    console.log(
        client.credentials,
        // client.credentials.refresh_token
    );
}

getRefreshToken();
