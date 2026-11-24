import { SCENES } from "@/components/store/scenes";
import { Mascot } from "@/components/store/app";
import { StoreAura } from "@/components/StoreAura";
import "../store.css";
import "./feature-graphic.css";

/** Google Play feature graphic, 1024 x 500. */
export default function FeatureGraphic() {
  const Assistant = SCENES.assistant;
  return (
    <main className="feature-studio">
      <article className="feature-graphic" data-export-feature-graphic>
        <StoreAura index={0} count={1} className="feature-aura" />
        <div className="feature-copy">
          <div className="feature-mark"><Mascot size={62} />Stella</div>
          <h1>Your personal<br />assistant.</h1>
        </div>
        <div className="feature-phone frame-android"><Assistant frame="android" height={1940} top={60} bottom={60} /></div>
      </article>
    </main>
  );
}
