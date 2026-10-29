import { Banner } from "./components";
import { SIMULATED } from "./labels";

export function SimulatedBanner() {
  return (
    <Banner label={SIMULATED}>
      Some participants in this meeting are simulated. Their answers were generated, not given by a
      person.
    </Banner>
  );
}
