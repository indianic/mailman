import { getAccessToken, type OAuth2Credentials } from '../auth/oauth2.js';

const PEOPLE_API_BASE = 'https://people.googleapis.com/v1/people/me/connections';

export interface GoogleContact {
  email: string;
  name?: string;
}

interface PeopleApiPage {
  connections?: Array<{
    names?: Array<{ displayName?: string }>;
    emailAddresses?: Array<{ value?: string }>;
  }>;
  nextPageToken?: string;
}

/**
 * Only for oauth2 accounts (contacts.readonly scope, requested in Phase 4).
 * Never cached to disk — fetched live on every suggest_recipients/
 * list_contacts call. See docs/PLAN.md's "Recipient suggestions" section.
 */
export async function fetchGoogleContacts(credentials: OAuth2Credentials): Promise<GoogleContact[]> {
  const accessToken = await getAccessToken(credentials);
  const contacts: GoogleContact[] = [];
  let pageToken: string | undefined;

  do {
    const url = new URL(PEOPLE_API_BASE);
    url.searchParams.set('personFields', 'names,emailAddresses');
    url.searchParams.set('pageSize', '200');
    if (pageToken) {
      url.searchParams.set('pageToken', pageToken);
    }

    const response = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
    if (!response.ok) {
      throw new Error(`Google People API request failed (${response.status}): ${await response.text()}`);
    }
    const data = (await response.json()) as PeopleApiPage;

    for (const person of data.connections ?? []) {
      const email = person.emailAddresses?.[0]?.value;
      if (email) {
        contacts.push({ email, name: person.names?.[0]?.displayName });
      }
    }
    pageToken = data.nextPageToken;
  } while (pageToken);

  return contacts;
}
