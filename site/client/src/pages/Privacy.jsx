import LegalLayout from './LegalLayout.jsx';
import Seo from '../components/Seo.jsx';

export default function Privacy() {
  return (
    <LegalLayout title="Privacy Policy" updated="2 July 2026">
      <Seo
        title="Privacy Policy — MailMan"
        description="How the MailMan website handles data. Newsletter emails only; your Gmail credentials are encrypted on your own machine and never uploaded."
        path="/privacy"
      />
      <p>
        This policy explains what this website collects. It covers the MailMan
        marketing site only — the MailMan tool itself stores your email
        credentials <strong>encrypted on your own machine</strong> and never
        transmits them to us.
      </p>

      <h2>What we collect</h2>
      <ul>
        <li>
          <strong>Newsletter email.</strong> If you subscribe via the footer, we
          store the email address and the time you subscribed.
        </li>
        <li>
          <strong>Nothing else.</strong> No accounts, no tracking cookies, no
          third-party analytics scripts are set by this site.
        </li>
      </ul>

      <h2>How we use it</h2>
      <ul>
        <li>To send occasional product updates and release notes about MailMan.</li>
        <li>We never sell or rent your address.</li>
      </ul>

      <h2>Where it lives</h2>
      <p>
        Subscriber emails are stored in a PostgreSQL database controlled by
        IndiaNIC. Access is limited to what is needed to operate the newsletter.
      </p>

      <h2>Your choices</h2>
      <ul>
        <li>Unsubscribe any time via the link in any email we send.</li>
        <li>
          Request deletion of your address by contacting{' '}
          <a href="mailto:privacy@indianic.com">privacy@indianic.com</a>.
        </li>
      </ul>

      <h2>The MailMan tool</h2>
      <p>
        MailMan reaches your Gmail directly over SMTP/IMAP or the Gmail API.
        Your credentials are encrypted with AES-256-GCM under a key held in your
        operating system’s keychain. They are never uploaded to IndiaNIC.
      </p>

      <h2>Contact</h2>
      <p>
        Questions? Email <a href="mailto:privacy@indianic.com">privacy@indianic.com</a>.
      </p>
    </LegalLayout>
  );
}
