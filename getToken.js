const path = require('path');
const { authenticate } = require('@google-cloud/local-auth');
const { google } = require('googleapis');
const scopes = require('./scopes');

async function getRefreshToken() {
    const client = await authenticate({
        keyfilePath: path.join(process.cwd(), 'credentials.json'),
        scopes,
    });

    console.log(
        client.credentials
        // client.credentials.refresh_token
    );
}

async function getNewAccessToken() {
    const clientId = process.env.CLIENT_ID;
    const clientSecret = process.env.CLIENT_SECRET;
    const refreshToken = process.env.REFRESH_TOKEN;

    const oauth2Client = new google.auth.OAuth2(clientId, clientSecret);

    // Set the refresh token on the client
    oauth2Client.setCredentials({ refresh_token: refreshToken });

    try {
        const res = await oauth2Client.getAccessToken(); // this will get a new access token using the provided refresh token
        const accessToken = res.token;

        // Here you can set the new access token to the client or save it somewhere else if needed
        oauth2Client.setCredentials({ access_token: accessToken });

        return accessToken;
    } catch (error) {
        console.error('Error refreshing access token', error);
        throw error;
    }
}

getRefreshToken();
