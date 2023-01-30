# Google Fit Telegram Integration
This script will get data from your Google Fit and calculate your average calories intake and TDEE from the past 30 days.

It also gives you the average calories and protein intake in the past 30 days.

This will only work if you have macro data everyday and weight data at least in the first day and the last day of the 30 days period, otherwise it can't calculate the TDEE.

## Env keys
- *TOKEN_TYPE*: Token type from Google Cloud
- *CLIENT_ID*: Client ID from Google Cloud
- *CLIENT_SECRET*: Client secret from Google Cloud
- *REFRESH_TOKEN*: Refresh token from Google Cloud
- *TELEGRAM_BOT_ID*: Telegram BOT API key
- *TELEGRAM_GROUP_ID*: Telegram Group Chat ID

You can add these keys on the GitHub settings for your project, for example: https://github.com/blopa/google-fit-telegram/settings/secrets/actions
