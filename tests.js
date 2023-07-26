require('dotenv').config();
const { google } = require('googleapis');
const { writeFileSync } = require('fs');
const scopes = require('./scopes');

const fitness = google.fitness('v1');

async function listDataSources() {
    const oauth2Client = new google.auth.OAuth2(
        process.env.CLIENT_ID,
        process.env.CLIENT_SECRET,
        null,
        { scope: scopes }
    );

    oauth2Client.setCredentials({ refresh_token: process.env.REFRESH_TOKEN });

    // Refresh the token and set the credentials
    const { token: accessToken } = await oauth2Client.getAccessToken();
    oauth2Client.setCredentials({ access_token: accessToken });

    const response = await fitness.users.dataSources.list({
        userId: 'me',
        auth: oauth2Client,
    });

    writeFileSync('output/google_fit_data.json', JSON.stringify(response.data, null, 2));
}

listDataSources();
