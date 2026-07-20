import detectionReference from "@/data/fmea-detection-reference.json";
import occurrenceReference from "@/data/fmea-occurrence-reference.json";
import severityReference from "@/data/fmea-severity-reference.json";
import propagationPaths from "@/data/turbofan-propagation-paths.json";

export function ScoringReferenceGuides() {
  return (
    <section className="reference-section" aria-label="Scoring references">
      <details className="reference-disclosure">
        <summary>Severity scoring guide</summary>
        <p className="reference-description">
          Severity is an engineer input. Any value shown as “Suggested” in the worksheet is a keyword-based starting point, not an assigned score.
        </p>
        <div className="reference-table-wrap">
          <table className="reference-table severity-guide-table">
            <thead><tr><th>S</th><th>Class</th><th>System effect</th><th>Guidance</th></tr></thead>
            <tbody>
              {severityReference.map((item) => (
                <tr key={item.score}>
                  <td>{item.score}</td><td>{item.classification}</td><td>{item.systemEffect}</td><td>{item.scoringGuidance}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>

      <details className="reference-disclosure">
        <summary>Occurrence scoring guide</summary>
        <p className="reference-description">
          Occurrence is an engineer input based on field history, duty cycle, and the applicable standard.
          The worksheet suggestion uses corpus frequency only as a review prompt; publication frequency is not failure probability.
        </p>
        <div className="reference-table-wrap">
          <table className="reference-table occurrence-guide-table">
            <thead><tr><th>O</th><th>Likelihood</th><th>Weighted evidence</th><th>Guidance</th></tr></thead>
            <tbody>
              {occurrenceReference.map((item) => (
                <tr key={item.score}>
                  <td>{item.score}</td><td>{item.likelihood}</td><td>{item.weightedEvidence}</td><td>{item.scoringGuidance}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>

      <details className="reference-disclosure">
        <summary>Detection scoring guide</summary>
        <p className="reference-description">
          Detection is an engineer input tied to the actual control plan. The worksheet suggestion
          only recognizes documented inspection, monitoring, latent-failure, and sudden-event terms.
        </p>
        <div className="reference-table-wrap">
          <table className="reference-table detection-guide-table">
            <thead><tr><th>D</th><th>Detectability</th><th>Meaning</th></tr></thead>
            <tbody>
              {detectionReference.map((item) => (
                <tr key={item.score}><td>{item.score}</td><td>{item.detectability}</td><td>{item.meaning}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>

      <details className="reference-disclosure">
        <summary>Severity propagation paths</summary>
        <div className="reference-table-wrap">
          <table className="reference-table propagation-table">
            <thead>
              <tr><th>Cause</th><th>Component failure</th><th>Local effect</th><th>Engine effect</th><th>Mission consequence</th><th>S</th></tr>
            </thead>
            <tbody>
              {propagationPaths.map((path) => (
                <tr key={`${path.cause}-${path.componentFailure}`}>
                  <td>{path.cause}</td><td>{path.componentFailure}</td><td>{path.localEffect}</td>
                  <td>{path.engineEffect}</td><td>{path.aircraftMissionConsequence}</td><td>{path.suggestedSeverity}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </section>
  );
}
