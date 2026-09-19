# InfoVerify Privacy Policy

Last updated: 2026-06-01

InfoVerify is a Chrome extension that analyzes the text you select or the current page URL you choose to verify.

## Data we process

When you use the extension, we may process:
- the text you select on a page
- the current page URL
- page title and page text needed for local analysis
- optional debugging information you copy manually

## Where data is processed

- Local AI features run in your browser using Chrome built-in AI APIs when available.
- Google News RSS requests may send a short search query derived from the text, title, and page content you actively choose to analyze to Google.
- We do not require an account for the extension itself.

### Optional Cloud AI (bring your own key)

Cloud AI is **off by default** and only runs when you click the "Cloud AI" button after adding your own Google Gemini API key in Settings. When you use it:

- The selected text and current page content are sent to Google's Gemini API (`generativelanguage.googleapis.com`) using your key, so Gemini can verify the claim.
- Gemini uses Google Search grounding to find independent sources for cross-validation; the search queries it issues are determined by the model.
- Your Gemini API key is stored only in local extension storage on this device (never synced) and is sent only to Google's API as the request credential.
- Data sent to Google is handled under Google's own terms and privacy policy. If you never enter a key and never click "Cloud AI", nothing is sent to Google.

## What we do not do

- We do not sell personal data.
- We do not use your data for ad targeting.
- We do not intentionally collect browsing history beyond the page you actively ask the extension to analyze.

## Storage

- Extension settings are stored in Chrome sync/local storage. The optional Gemini API key is stored in local storage only (never synced).
- Debug traces are shown only in the extension UI and are copied only when you click the copy button.

## Questions

If you have questions about this policy, contact the extension author using the project contact information provided with the Chrome Web Store listing.
