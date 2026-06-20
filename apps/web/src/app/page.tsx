"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import fmeaData from "@/data/fmea-turbofan-data.json";

type Source = {
  title: string;
  year?: string;
  doi?: string;
  url?: string;
};

type FmeaRow = {
  component: string;
  failureMode: string;
  effect: string;
  cause: string;
  severity: string;
  occurrence: string;
  detection: string;
  correctiveAction: string;
  rpn: string;
  evidenceCount: number;
  sources: Source[];
};

const COMPONENTS = [
  "Nacelle",
  "Engine inlet / intake",
  "Fan / fan blade",
  "Fan case",
  "Low-pressure compressor",
  "High-pressure compressor",
  "Combustor",
  "High-pressure turbine",
  "Low-pressure turbine",
  "Shaft",
  "Bearing",
  "Gearbox / accessory gearbox",
];

const PART_LABELS = {
  "fan-1": { label: "Fan", component: "Fan / fan blade", row: 0 },
  "2kTrent_900_Jeth_CFM_56_cover_7-1": { label: "Fan Case", component: "Fan case", row: 1 },
  "LPC_youssef_and_Ammar-1": { label: "Low-Pressure Compressor", component: "Low-pressure compressor", row: 2 },
  "HTP325-1": { label: "High-Pressure Compressor", component: "High-pressure compressor", row: 0 },
  "combustion-1": { label: "Combustor", component: "Combustor", row: 1 },
  "Back_Casing-1": { label: "Core Engine Case", component: "Nacelle", row: 2 },
  "HPT_Abbass-1": { label: "High-Pressure Turbine", component: "High-pressure turbine", row: 0 },
  "LPT-1": { label: "Low-Pressure Turbine", component: "Low-pressure turbine", row: 1 },
  "exhaust-1": { label: "Exhaust Cone", component: "Nacelle", row: 2 },
} as const;

const PART_COLORS: Record<string, { color: number; metalness: number; roughness: number }> = {
  "fan-1": { color: 0xe2e2e2, metalness: 0.3, roughness: 0.5 },
  "LPC_youssef_and_Ammar-1": { color: 0xd8d8d8, metalness: 0.32, roughness: 0.52 },
  "HTP325-1": { color: 0xdcdcdc, metalness: 0.3, roughness: 0.5 },
  "combustion-1": { color: 0xd6d6d6, metalness: 0.32, roughness: 0.54 },
  "HPT_Abbass-1": { color: 0xdcdcdc, metalness: 0.3, roughness: 0.5 },
  "LPT-1": { color: 0xd8d8d8, metalness: 0.32, roughness: 0.52 },
  "exhaust-1": { color: 0xd2d2d2, metalness: 0.32, roughness: 0.54 },
  "Back_Casing-1": { color: 0xd6d6d6, metalness: 0.3, roughness: 0.52 },
  "2kTrent_900_Jeth_CFM_56_cover_7-1": { color: 0xe6e6e6, metalness: 0.22, roughness: 0.58 },
};

const SYSTEM_PATHS = [
  {
    name: "Air Path",
    tone: "air",
    items: ["Fan", "LPC", "HPC", "Combustor", "Turbine"],
  },
  {
    name: "Fuel Path",
    tone: "fuel",
    items: ["Pumps", "Valves", "Nozzles"],
  },
  {
    name: "Oil Path",
    tone: "oil",
    items: ["Bearings", "Seals", "Pumps"],
  },
  {
    name: "Control Path",
    tone: "control",
    items: ["FADEC", "Sensors", "Actuators"],
  },
];

function splitTerms(value: string) {
  return value
    .split(";")
    .map((item) => item.trim())
    .filter(Boolean);
}

function TermCell({ value }: { value: string }) {
  const terms = splitTerms(value);
  if (!terms.length) return <span className="blank">blank</span>;
  if (terms.length === 1) return <>{terms[0]}</>;
  return (
    <div className="term-list">
      {terms.map((term) => (
        <span key={term}>{term}</span>
      ))}
    </div>
  );
}

function sourceId(source: Source) {
  return [source.doi, source.title, source.year].filter(Boolean).join("|");
}

function TurbofanModel({
  componentClass,
  getCount,
  handleComponentSelect,
}: {
  componentClass: (component: string, baseClass: string) => string;
  getCount: (component: string) => number;
  handleComponentSelect: (component: string) => void;
}) {
  const mountRef = useRef<HTMLDivElement | null>(null);
  const labelRefs = useRef<Record<string, HTMLButtonElement | null>>({});

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;

    let disposed = false;
    let frame = 0;
    let renderer: import("three").WebGLRenderer | null = null;
    let scene: import("three").Scene | null = null;
    let camera: import("three").PerspectiveCamera | null = null;
    const modelNodes = new Map<string, import("three").Object3D>();
    const centerOffsets = new Map<string, import("three").Vector3>();
    const disposables: Array<{ dispose: () => void }> = [];

    async function init() {
      const THREE = await import("three");
      const { GLTFLoader } = await import("three/addons/loaders/GLTFLoader.js");
      const { DRACOLoader } = await import("three/addons/loaders/DRACOLoader.js");
      if (!mount || disposed) return;

      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
      renderer.setSize(mount.clientWidth, mount.clientHeight);
      renderer.setClearColor(0x000000, 0);
      renderer.outputColorSpace = THREE.SRGBColorSpace;
      renderer.toneMapping = THREE.ACESFilmicToneMapping;
      renderer.toneMappingExposure = 1.08;
      mount.appendChild(renderer.domElement);

      scene = new THREE.Scene();
      camera = new THREE.PerspectiveCamera(42, mount.clientWidth / mount.clientHeight, 0.001, 10000000);
      scene.add(new THREE.AmbientLight(0xffffff, 0.7));
      [
        [4, 6, 5, 1.4],
        [-4, -2, -5, 0.55],
        [0, 9, 0, 0.4],
        [-3, 2, 6, 0.35],
      ].forEach(([x, y, z, intensity]) => {
        const light = new THREE.DirectionalLight(0xffffff, intensity);
        light.position.set(x, y, z);
        scene?.add(light);
      });

      const draco = new DRACOLoader();
      draco.setDecoderPath("/draco/");
      disposables.push(draco);
      const loader = new GLTFLoader();
      loader.setDRACOLoader(draco);

      loader.load("/turbine.glb", (gltf) => {
        if (disposed || !scene || !camera || !renderer || !mount) return;
        const root = gltf.scene;
        scene.add(root);

        let assembly: import("three").Object3D = root;
        root.traverse((node) => {
          if (node.name.includes("Turbo Fan") || node.name.includes("trent")) assembly = node;
        });

        assembly.children.forEach((child) => {
          const cfg = PART_COLORS[child.name] ?? { color: 0xe0dfdb, metalness: 0.28, roughness: 0.55 };
          const material = new THREE.MeshStandardMaterial(cfg);
          disposables.push(material);
          child.traverse((node) => {
            const mesh = node as import("three").Mesh;
            if (mesh.isMesh) {
              mesh.material = material;
              disposables.push(mesh.geometry);
            }
          });
          modelNodes.set(child.name, child);
        });

        root.updateWorldMatrix(true, true);
        const box = new THREE.Box3().setFromObject(root);
        const size = box.getSize(new THREE.Vector3());
        const modelCenter = box.getCenter(new THREE.Vector3());
        const modelRadius = Math.max(size.x, size.y, size.z) * 0.5 || 1;

        const children = [...assembly.children];
        const centers = children.map((child) => new THREE.Box3().setFromObject(child).getCenter(new THREE.Vector3()));
        const mean = centers.reduce((acc, value) => acc.add(value), new THREE.Vector3()).divideScalar(Math.max(centers.length, 1));
        const variance = centers.reduce(
          (acc, value) => {
            const delta = value.clone().sub(mean);
            acc.x += delta.x * delta.x;
            acc.y += delta.y * delta.y;
            acc.z += delta.z * delta.z;
            return acc;
          },
          new THREE.Vector3(),
        );
        const axis =
          variance.y > variance.x && variance.y > variance.z
            ? new THREE.Vector3(0, 1, 0)
            : variance.z > variance.x && variance.z > variance.y
              ? new THREE.Vector3(0, 0, 1)
              : new THREE.Vector3(1, 0, 0);

        const radialDir = new Map<string, import("three").Vector3>();
        const axialExtent = new Map<string, number>();
        const axisIndex = axis.y ? "y" : axis.z ? "z" : "x";
        const axialByName = new Map<string, number>();
        children.forEach((child) => {
          const cbox = new THREE.Box3().setFromObject(child);
          const csize = cbox.getSize(new THREE.Vector3());
          const childCenter = cbox.getCenter(new THREE.Vector3());
          const childOrigin = new THREE.Vector3();
          child.getWorldPosition(childOrigin);
          centerOffsets.set(child.name, childCenter.clone().sub(childOrigin));
          axialByName.set(child.name, childCenter.clone().sub(modelCenter).dot(axis));
          axialExtent.set(child.name, (csize as unknown as Record<string, number>)[axisIndex] * 0.5);
          const offset = childCenter.clone().sub(modelCenter);
          const axialPart = axis.clone().multiplyScalar(offset.dot(axis));
          const pureRadial = offset.sub(axialPart);
          radialDir.set(
            child.name,
            pureRadial.length() > modelRadius * 0.02 ? pureRadial.normalize() : new THREE.Vector3(0, 1, 0),
          );
        });

        const orderedNames = children.map((child) => child.name).sort((a, b) => (axialByName.get(a) ?? 0) - (axialByName.get(b) ?? 0));
        const axialOffset = new Map<string, number>();
        let cursor = 0;
        let prevExt = 0;
        orderedNames.forEach((name, index) => {
          const ext = axialExtent.get(name) ?? 0;
          cursor = index === 0 ? 0 : cursor + prevExt + ext + modelRadius * 0.18;
          axialOffset.set(name, cursor);
          prevExt = ext;
        });
        const offsets = [...axialOffset.values()];
        const mid = (Math.min(...offsets) + Math.max(...offsets)) / 2;
        const explodeBox = new THREE.Box3();
        children.forEach((child) => {
          const offset = axis
            .clone()
            .multiplyScalar((axialOffset.get(child.name) ?? 0) - mid)
            .addScaledVector(radialDir.get(child.name) ?? new THREE.Vector3(0, 1, 0), modelRadius * 0.22);
          child.position.add(offset);
          const cbox = new THREE.Box3().setFromObject(child);
          explodeBox.union(cbox);
        });

        root.updateWorldMatrix(true, true);
        const explodedSize = explodeBox.getSize(new THREE.Vector3());
        const explodedCenter = explodeBox.getCenter(new THREE.Vector3());
        const explodedRadius = Math.max(explodedSize.x, explodedSize.y, explodedSize.z) * 0.5 || modelRadius;
        const look = explodedCenter;
        const side = axis.clone().cross(new THREE.Vector3(0, 1, 0));
        if (side.length() < 0.1) side.set(0, 0, 1);
        side.normalize();
        camera.position
          .copy(look)
          .addScaledVector(side, explodedRadius * 2.45)
          .add(new THREE.Vector3(0, explodedRadius * 0.28, 0));
        camera.near = explodedRadius * 0.001;
        camera.far = explodedRadius * 500;
        camera.lookAt(look);
        camera.updateProjectionMatrix();

        const projectLabels = () => {
          const width = mount.clientWidth;
          const height = mount.clientHeight;
          Object.entries(PART_LABELS).forEach(([partName]) => {
            const label = labelRefs.current[partName];
            const node = modelNodes.get(partName);
            if (!label || !node || !camera) return;
            const world = new THREE.Vector3();
            node.getWorldPosition(world);
            world.add(centerOffsets.get(partName) ?? new THREE.Vector3());
            const ndc = world.project(camera);
            if (Math.abs(ndc.z) > 1.05 || ndc.x < -1.15 || ndc.x > 1.15) {
              label.style.opacity = "0";
              return;
            }
            label.style.left = `${(((ndc.x + 1) / 2) * width).toFixed(1)}px`;
            label.style.top = `${(((-ndc.y + 1) / 2) * height).toFixed(1)}px`;
            label.style.opacity = "1";
          });
        };

        const render = () => {
          if (disposed || !renderer || !scene || !camera) return;
          projectLabels();
          renderer.render(scene, camera);
          frame = requestAnimationFrame(render);
        };
        render();
      });

      const resize = () => {
        if (!mount || !renderer || !camera) return;
        renderer.setSize(mount.clientWidth, mount.clientHeight);
        camera.aspect = mount.clientWidth / mount.clientHeight;
        camera.updateProjectionMatrix();
      };
      window.addEventListener("resize", resize);
      disposables.push({ dispose: () => window.removeEventListener("resize", resize) });
    }

    init();

    return () => {
      disposed = true;
      cancelAnimationFrame(frame);
      disposables.forEach((item) => item.dispose());
      renderer?.dispose();
      mount.replaceChildren();
    };
  }, []);

  return (
    <div className="model-stage">
      <div ref={mountRef} className="model-canvas" aria-label="3D turbofan engine exploded model" />
      <div className="part-labels" aria-label="Exploded model part labels">
        {Object.entries(PART_LABELS).map(([partName, { label, component, row }]) => (
          <button
            className={componentClass(component, "part-label")}
            data-row={row}
            key={partName}
            ref={(node) => {
              labelRefs.current[partName] = node;
            }}
            type="button"
            title={`${component}: ${getCount(component)} evidence records`}
            onClick={() => handleComponentSelect(component)}
          >
            {label}
          </button>
        ))}
      </div>
    </div>
  );
}

export default function Home() {
  const [query, setQuery] = useState("turbofan engine");
  const [activeComponent, setActiveComponent] = useState("All");
  const [coverage, setCoverage] = useState("all");
  const [selectedRow, setSelectedRow] = useState<FmeaRow | null>(null);

  const rows = fmeaData.rows as FmeaRow[];
  const systemMatches =
    !query.trim() ||
    fmeaData.system.toLowerCase().includes(query.toLowerCase()) ||
    query.toLowerCase().includes("turbofan") ||
    query.toLowerCase().includes("engine");

  const componentCounts = useMemo(() => {
    const sets = new Map<string, Set<string>>();
    COMPONENTS.forEach((component) => sets.set(component, new Set()));
    rows.forEach((row) => {
      if (!sets.has(row.component)) sets.set(row.component, new Set());
      row.sources.forEach((source) => sets.get(row.component)?.add(sourceId(source)));
    });
    return [...sets.entries()]
      .map(([component, sources]) => ({ component, count: sources.size }))
      .sort((a, b) => {
        if (b.count !== a.count) return b.count - a.count;
        return COMPONENTS.indexOf(a.component) - COMPONENTS.indexOf(b.component);
      });
  }, [rows]);

  const filteredRows = useMemo(() => {
    if (!systemMatches) return [];
    const componentOrder = componentCounts.map((item) => item.component);
    return rows
      .filter((row) => {
        if (activeComponent !== "All" && row.component !== activeComponent) return false;
        if (coverage === "effect" && !row.effect) return false;
        if (coverage === "cause" && !row.cause) return false;
        return true;
      })
      .sort((a, b) => {
        const componentDelta = componentOrder.indexOf(a.component) - componentOrder.indexOf(b.component);
        if (componentDelta !== 0) return componentDelta;
        if (b.evidenceCount !== a.evidenceCount) return b.evidenceCount - a.evidenceCount;
        return a.failureMode.localeCompare(b.failureMode);
      });
  }, [activeComponent, componentCounts, coverage, rows, systemMatches]);

  const getCount = (component: string) =>
    componentCounts.find((item) => item.component === component)?.count ?? 0;

  const handleComponentSelect = (component: string) => {
    setActiveComponent(activeComponent === component ? "All" : component);
  };

  const componentClass = (component: string, baseClass: string) =>
    `${baseClass} ${activeComponent === component ? "active" : ""} ${
      activeComponent !== "All" && activeComponent !== component ? "muted" : ""
    }`;

  let previousComponent = "";

  return (
    <main className="app-shell">
      <header className="topbar">
        <a className="brand" href="https://riskonradar.com/">
          risk on radar<span>.</span>
        </a>
        <nav className="topnav" aria-label="Product navigation">
          <a href="#system-search-title">System</a>
          <a href="#system-map">Map</a>
          <a href="#fmea-table">Worksheet</a>
        </nav>
      </header>

      <section className="workspace-shell">
        <section className="system-strip" aria-labelledby="system-search-title">
          <div className="system-strip-search">
            <label className="source-label" id="system-search-title" htmlFor="system-search">
              System name
            </label>
            <div className="search-row">
              <input
                id="system-search"
                type="search"
                value={query}
                placeholder="Search a system, e.g. turbofan engine"
                onChange={(event) => {
                  setQuery(event.target.value);
                  setActiveComponent("All");
                }}
              />
              <button type="button" aria-label="Clear search" onClick={() => setQuery("")}>
                x
              </button>
            </div>
          </div>
          <div className="evidence-pill" aria-live="polite">
            <span className="source-label">Total evidence records</span>
            <strong>{fmeaData.recordCount}</strong>
          </div>
        </section>
        {!systemMatches && <p className="empty-state">No system in this prototype matches that search yet.</p>}

        <section className="exploded-view" aria-label="Turbofan exploded component view">
          <div className="map-head">
            <div>
              <p className="eyebrow">Exploded view</p>
            </div>
          </div>
          <div className="model-layout">
            <TurbofanModel
              componentClass={componentClass}
              getCount={getCount}
              handleComponentSelect={handleComponentSelect}
            />
          </div>
        </section>

        <section id="system-map" className="system-map" aria-label="Turbofan component interaction map">
          <div className="map-head">
            <div>
              <p className="eyebrow">System map</p>
              <h2>System reliability structure</h2>
            </div>
          </div>
          <div className="system-flow">
            {SYSTEM_PATHS.map((path) => (
              <section className={`flow-lane flow-lane-${path.tone}`} key={path.name}>
                <h3>{path.name}</h3>
                <div className="lane-items">
                  {path.items.map((item, index) => (
                    <span className="lane-item" key={`${path.name}-${item}`}>
                      {item}
                      {index < path.items.length - 1 && <i aria-hidden="true" />}
                    </span>
                  ))}
                </div>
              </section>
            ))}
          </div>
        </section>

        <section className="content-grid">
          <aside className="component-panel" aria-label="Components">
            <div className="panel-head">
              <h2>Components</h2>
              <span>{activeComponent}</span>
            </div>
            <div className="component-list">
              <button
                className={`component-button ${activeComponent === "All" ? "active" : ""}`}
                type="button"
                onClick={() => setActiveComponent("All")}
              >
                <span>All components</span>
                <span>{componentCounts.reduce((total, item) => total + item.count, 0)} papers</span>
              </button>
              {componentCounts.map(({ component, count }) => (
                <button
                  className={`component-button ${activeComponent === component ? "active" : ""}`}
                  key={component}
                  type="button"
                  onClick={() => setActiveComponent(component)}
                >
                  <span>{component}</span>
                  <span>{count}</span>
                </button>
              ))}
            </div>
          </aside>

          <section className="table-panel" aria-labelledby="table-title">
            <div className="table-toolbar">
              <div>
                <p className="eyebrow">Generated FMEA worksheet</p>
                <h2 id="table-title">Failure modes, effects, and causes</h2>
              </div>
              <select value={coverage} onChange={(event) => setCoverage(event.target.value)}>
                <option value="all">All evidence rows</option>
                <option value="effect">Has effect</option>
                <option value="cause">Has cause</option>
              </select>
            </div>

            <div className="table-wrap">
              <table id="fmea-table">
                <thead>
                  <tr>
                    <th>Component</th>
                    <th>Failure mode</th>
                    <th>Effect</th>
                    <th>Cause</th>
                    <th>S</th>
                    <th>O</th>
                    <th>D</th>
                    <th>Corrective action</th>
                    <th>RPN</th>
                    <th>Evidence</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredRows.map((row) => {
                    const repeated = previousComponent === row.component;
                    previousComponent = row.component;
                    return (
                      <tr key={`${row.component}-${row.failureMode}`}>
                        <td className={repeated ? "component-repeat" : "component-start"}>
                          {repeated ? "" : row.component}
                        </td>
                        <td>{row.failureMode}</td>
                        <td>
                          <TermCell value={row.effect} />
                        </td>
                        <td>
                          <TermCell value={row.cause} />
                        </td>
                        <td className="score-cell blank">blank</td>
                        <td className="score-cell blank">blank</td>
                        <td className="score-cell blank">blank</td>
                        <td className="action-cell blank">blank</td>
                        <td className="score-cell blank">blank</td>
                        <td>
                          <button className="evidence-button" type="button" onClick={() => setSelectedRow(row)}>
                            {row.evidenceCount} paper{row.evidenceCount === 1 ? "" : "s"}
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            {!filteredRows.length && <p className="empty-state">No extracted rows match this view.</p>}
          </section>
        </section>
      </section>

      {selectedRow && (
        <div className="source-dialog-backdrop" role="presentation" onClick={() => setSelectedRow(null)}>
          <section className="source-dialog" role="dialog" aria-modal="true" onClick={(event) => event.stopPropagation()}>
            <button className="dialog-close" type="button" aria-label="Close" onClick={() => setSelectedRow(null)}>
              x
            </button>
            <p className="eyebrow">Evidence for row</p>
            <h3>
              {selectedRow.component} - {selectedRow.failureMode}
            </h3>
            <p className="hint">Structured classifier output remains review-required engineering evidence.</p>
            <ul className="source-list">
              {selectedRow.sources.map((source) => (
                <li key={sourceId(source)}>
                  <strong>{source.title}</strong>
                  <span>
                    {source.doi ? `DOI: ${source.doi}` : source.url || "RIS source record"}
                    {source.year ? ` - ${source.year}` : ""}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        </div>
      )}
    </main>
  );
}
