import Seo from '../components/Seo.jsx';
import Hero from '../components/Hero.jsx';
import WhatIsIt from '../components/WhatIsIt.jsx';
import Features from '../components/Features.jsx';
import Workbench from '../components/Workbench.jsx';
import Constellation from '../components/Constellation.jsx';
import Compatibility from '../components/Compatibility.jsx';
import HowItWorks from '../components/HowItWorks.jsx';
import HowToUse from '../components/HowToUse.jsx';
import Examples from '../components/Examples.jsx';
import Faq from '../components/Faq.jsx';
import Install from '../components/Install.jsx';

export default function Home() {
  return (
    <>
      <Seo
        title="MailMan — Email for your AI assistant"
        description="Send and read Gmail just by asking your AI assistant. Draft, preview, confirm — nothing sends without your OK. Works with Claude, Cursor, Gemini, OpenAI on macOS, Linux and Windows."
        path="/"
      />
      <Hero />
      <WhatIsIt />
      <Workbench />
      <Features />
      <Constellation />
      <Compatibility />
      <HowItWorks />
      <HowToUse />
      <Examples />
      <Install />
      <Faq />
    </>
  );
}
