import Hero from '../components/Hero.jsx';
import WhatIsIt from '../components/WhatIsIt.jsx';
import Features from '../components/Features.jsx';
import Compatibility from '../components/Compatibility.jsx';
import HowItWorks from '../components/HowItWorks.jsx';
import Faq from '../components/Faq.jsx';
import Install from '../components/Install.jsx';

export default function Home() {
  return (
    <>
      <Hero />
      <WhatIsIt />
      <Features />
      <Compatibility />
      <HowItWorks />
      <Faq />
      <Install />
    </>
  );
}
