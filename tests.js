const { google } = require('googleapis');
const { writeFileSync } = require('fs');
const scopes = require('./scopes');

async function listDataSources() {
    const auth = await google.auth.fromJSON({
        type: process.env.TOKEN_TYPE,
        client_id: process.env.CLIENT_ID,
        client_secret: process.env.CLIENT_SECRET,
        refresh_token: process.env.REFRESH_TOKEN,
    });

    auth.scopes = scopes;

    const { token: accessToken } = await auth.getAccessToken();
    auth.setCredentials({ access_token: accessToken });

    const response = await fitness.users.dataSources.list({
        userId: 'me',
        auth,
    });

    writeFileSync('google_fit_data.json', JSON.stringify(response.data, null, 2));
    console.log('Data saved to google_fit_data.json');
}
