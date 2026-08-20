import { Hero } from './_components/hero';
import { TrustBar } from './_components/trust-bar';
import { BentoFeatures } from './_components/bento-features';
import { HowItWorks } from './_components/how-it-works';
import { EmployeeShowcase } from './_components/employee-showcase';
import { Pricing } from './_components/pricing';
import { FaqGlass } from './_components/faq-glass';
import { CtaBlock } from './_components/cta-block';

/** 官网落地页。区块顺序对应 PRD §7.2 – §7.9。 */
export default function LandingPage() {
  return (
    <>
      <Hero />
      <TrustBar />
      <BentoFeatures />
      <HowItWorks />
      <EmployeeShowcase />
      <Pricing />
      <FaqGlass />
      <CtaBlock />
    </>
  );
}
