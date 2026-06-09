# Google OAuth Verification Checklist

Last updated: May 2026

## Application identity

- App name: עובד משרד חכם
- Operator / company contact: Shay Mida
- Support email: shaymida337@gmail.com
- Developer contact email: shaymida337@gmail.com
- Application purpose: business automation for Israeli small businesses.

## Public URLs required by Google

Use the custom-domain URLs after the domain is configured and verified in Google Search Console:

- Homepage: `https://app.<your-domain>/`
- Company information: `https://app.<your-domain>/company`
- Privacy Policy: `https://app.<your-domain>/privacy-policy`
- Terms of Service: `https://app.<your-domain>/terms`
- Data deletion instructions: `https://app.<your-domain>/data-deletion`

Current Render URLs can be used for testing, but they are not ideal for Google verification because the root domain `onrender.com` is not owned by this project.

## Authorized domain configuration

Google requires domains used in the OAuth consent screen and OAuth client configuration to be verified in Google Search Console.

Recommended production domain layout:

- Frontend: `https://app.<your-domain>`
- Backend/API: `https://api.<your-domain>`

Google Cloud Console OAuth consent screen:

- Authorized domain: `<your-domain>`
- Homepage URL: `https://app.<your-domain>/`
- Privacy Policy URL: `https://app.<your-domain>/privacy-policy`
- Terms of Service URL: `https://app.<your-domain>/terms`

Google Cloud Console OAuth client:

- Authorized JavaScript origin: `https://app.<your-domain>`
- Authorized redirect URIs:
  - `https://api.<your-domain>/auth/google/callback`
  - `https://api.<your-domain>/api/integrations/gmail/callback`
  - `https://api.<your-domain>/api/clients/gmail/callback`

Render environment variables:

- Backend `FRONTEND_URL=https://app.<your-domain>`
- Backend `GOOGLE_REDIRECT_URI=https://api.<your-domain>/auth/google/callback`
- Backend `GOOGLE_INTEGRATION_REDIRECT_URI=https://api.<your-domain>/api/integrations/gmail/callback`
- Backend `GOOGLE_CLIENT_REDIRECT_URI=https://api.<your-domain>/api/clients/gmail/callback`
- Frontend `NEXT_PUBLIC_API_URL=https://api.<your-domain>`

## Requested scopes and justifications

- `openid`: identifies the signed-in Google user during OAuth.
- `email`: receives the user's email address for account login and account matching.
- `profile`: receives the user's basic profile/name for account creation and display.
- `https://www.googleapis.com/auth/gmail.readonly`: reads Gmail messages and attachments to detect invoices, supplier payment requests, CRM leads, and business tasks.
- `https://www.googleapis.com/auth/gmail.labels`: lists and creates Gmail labels used to organize invoice-related messages. This is intentionally narrower than `gmail.modify`.
- `https://www.googleapis.com/auth/drive.file`: creates and manages Drive files/folders created by the app, such as uploaded invoices, supplier documents, WhatsApp files, and accountant reports.
- `https://www.googleapis.com/auth/spreadsheets`: creates and updates Sheets used by the app for supplier payments, client invoices, tasks, and accountant reports.

## Exact text for Google OAuth submission form

### App description

עובד משרד חכם is a business automation SaaS for Israeli small businesses. The app helps users manage business emails, invoices, supplier payment requests, client follow-ups, tasks, documents, reports, and daily office workflows in one dashboard.

### How the app uses Google data

Users explicitly connect their Google account through Google OAuth. After consent, the app uses Gmail to scan business emails and attachments for invoices, supplier payment requests, CRM leads, and tasks. The app uses Gmail labels to organize invoice-related messages, Drive to create folders and store documents created or uploaded through the app, and Sheets to create and update operational spreadsheets.

### Why each sensitive/restricted scope is needed

`gmail.readonly` is required to read messages and attachments so the app can detect invoices, payment requests, supplier documents, CRM leads, and tasks.

`gmail.labels` is required to list/create labels that organize invoice-related messages. The app does not need broader message modification permissions.

`drive.file` is required to create and manage files and folders created by the app, including invoices, supplier documents, WhatsApp attachments, and reports.

`spreadsheets` is required to create and update Google Sheets for supplier payments, client invoice tracking, task tracking, and accountant reports.

### Limited Use / privacy statement

The app uses Google user data only to provide user-facing business automation features requested by the user. Google user data is not sold, shared for advertising, or used to train general AI models. Access is limited to the connected organization’s workflows, and users can disconnect Google access or request deletion of stored data.

### Test instructions for Google reviewers

1. Open `https://app.<your-domain>/`.
2. Review the homepage, Privacy Policy, Terms of Service, and Data Deletion pages linked in the footer.
3. Sign in with Google or create a test account.
4. Open the dashboard and click the Gmail connection button.
5. Complete Google OAuth consent.
6. Return to the dashboard and run a Gmail scan.
7. Verify that detected invoices/payment requests appear in the dashboard and that created files/sheets are saved to the connected Google account.

## Pre-submission checklist

- [ ] Custom domain is connected to Render frontend and backend.
- [ ] Domain is verified in Google Search Console by an owner/editor of the Google Cloud project.
- [ ] OAuth consent screen uses the custom-domain homepage, privacy policy, and terms URLs.
- [ ] Footer links are visible on the homepage and app pages.
- [ ] Privacy Policy explains Google API data use and Limited Use.
- [ ] Terms explain Google permissions and user responsibilities.
- [ ] Data deletion page is public and explains deletion and Google access revocation.
- [ ] OAuth client redirect URIs use only production custom-domain URLs.
- [ ] No localhost redirect URI is used in production.
- [ ] Scopes are minimized and justified.
- [ ] Reviewer test account/instructions are ready.
