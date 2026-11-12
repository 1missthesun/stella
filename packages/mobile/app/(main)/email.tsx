import { Redirect } from "expo-router";
import { EmailPage } from "../../src/components/EmailPage";
import { MainDetailSurface } from "../../src/components/MainScreenSurface";
import { useEmailFeatureState } from "../../src/lib/email-feature";

export default function EmailScreen() {
  // Email shows only where it is turned on (see `email-feature.ts`); a saved last tab of Email lands in the chat.
  const { on, known } = useEmailFeatureState();
  if (!on) return known ? <Redirect href="/chat" /> : null;
  return (
    <MainDetailSurface>
      <EmailPage />
    </MainDetailSurface>
  );
}
