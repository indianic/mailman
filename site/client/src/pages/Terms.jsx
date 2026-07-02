import LegalLayout from './LegalLayout.jsx';
import Seo from '../components/Seo.jsx';

export default function Terms() {
  return (
    <LegalLayout title="Terms of Service" updated="2 July 2026">
      <Seo
        title="Terms of Service — MailMan"
        description="Terms governing use of the MailMan website and the @indianic/mailman software."
        path="/terms"
      />
      <p>
        These terms govern your use of the MailMan website and the{' '}
        <code>@indianic/mailman</code> software. By using either, you agree to them.
      </p>

      <h2>The software</h2>
      <ul>
        <li>
          MailMan is distributed as <code>@indianic/mailman</code> on the IndiaNIC
          private npm registry for use by IndiaNIC and authorised users.
        </li>
        <li>
          It is provided “as is,” without warranty of any kind. You are
          responsible for the emails you send through it.
        </li>
      </ul>

      <h2>Acceptable use</h2>
      <ul>
        <li>Do not use MailMan to send spam, unlawful, or abusive content.</li>
        <li>Respect Gmail’s and your organisation’s sending policies and limits.</li>
      </ul>

      <h2>Your credentials</h2>
      <p>
        You are responsible for keeping your Gmail app passwords and OAuth
        credentials secure. MailMan encrypts them locally, but access to your
        machine is your responsibility.
      </p>

      <h2>Limitation of liability</h2>
      <p>
        To the extent permitted by law, IndiaNIC is not liable for any indirect
        or consequential damages arising from use of the site or the software.
      </p>

      <h2>Changes</h2>
      <p>
        We may update these terms. Continued use after an update constitutes
        acceptance of the revised terms.
      </p>

      <h2>Contact</h2>
      <p>
        Questions? Email <a href="mailto:legal@indianic.com">legal@indianic.com</a>.
      </p>
    </LegalLayout>
  );
}
