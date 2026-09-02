import * as THREE from 'three';
import { mergeByMaterial, mergeGeometries, place, roundedBox } from './GeometryUtil';
import { decal, material } from './MaterialLibrary';
import { lightPool } from './LightPool';

/**
 * PROP_* library: the lineside and street furniture that makes a procedural
 * world read as a place rather than a corridor. Every prop is a real modelled
 * object with a consistent metre scale.
 */

export type PropId =
  // Railway infrastructure
  | 'PROP_SignalGantry' | 'PROP_SignalPost' | 'PROP_CatenaryMast' | 'PROP_CatenaryPortal'
  | 'PROP_RelayCabinet' | 'PROP_JunctionBox' | 'PROP_MilePost' | 'PROP_SpeedSign'
  | 'PROP_WarningBoard' | 'PROP_Fence' | 'PROP_MeshFence' | 'PROP_Gate'
  | 'PROP_CCTV' | 'PROP_FirePoint' | 'PROP_TrackLamp' | 'PROP_BufferStop'
  // Street furniture
  | 'PROP_StreetLight' | 'PROP_TrafficLight' | 'PROP_RoadSign' | 'PROP_Billboard'
  | 'PROP_Poster' | 'PROP_Bench' | 'PROP_Bin' | 'PROP_UtilityBox'
  | 'PROP_AcUnit' | 'PROP_PipeRun' | 'PROP_Generator' | 'PROP_Hydrant'
  | 'PROP_Bollard' | 'PROP_PhoneBox' | 'PROP_VendingStall' | 'PROP_Awning'
  // Construction
  | 'PROP_Scaffold' | 'PROP_Crane' | 'PROP_CementMixer' | 'PROP_PipeStack'
  | 'PROP_SandPile' | 'PROP_Portaloo' | 'PROP_SkipBin' | 'PROP_TrafficCone'
  // Industrial
  | 'PROP_Tank' | 'PROP_Chimney' | 'PROP_Conveyor' | 'PROP_Pallets'
  | 'PROP_Drum' | 'PROP_Ventilator' | 'PROP_Transformer' | 'PROP_Ladder';

export const PROP_IDS: PropId[] = [
  'PROP_SignalGantry', 'PROP_SignalPost', 'PROP_CatenaryMast', 'PROP_CatenaryPortal',
  'PROP_RelayCabinet', 'PROP_JunctionBox', 'PROP_MilePost', 'PROP_SpeedSign',
  'PROP_WarningBoard', 'PROP_Fence', 'PROP_MeshFence', 'PROP_Gate',
  'PROP_CCTV', 'PROP_FirePoint', 'PROP_TrackLamp', 'PROP_BufferStop',
  'PROP_StreetLight', 'PROP_TrafficLight', 'PROP_RoadSign', 'PROP_Billboard',
  'PROP_Poster', 'PROP_Bench', 'PROP_Bin', 'PROP_UtilityBox',
  'PROP_AcUnit', 'PROP_PipeRun', 'PROP_Generator', 'PROP_Hydrant',
  'PROP_Bollard', 'PROP_PhoneBox', 'PROP_VendingStall', 'PROP_Awning',
  'PROP_Scaffold', 'PROP_Crane', 'PROP_CementMixer', 'PROP_PipeStack',
  'PROP_SandPile', 'PROP_Portaloo', 'PROP_SkipBin', 'PROP_TrafficCone',
  'PROP_Tank', 'PROP_Chimney', 'PROP_Conveyor', 'PROP_Pallets',
  'PROP_Drum', 'PROP_Ventilator', 'PROP_Transformer', 'PROP_Ladder',
];

/** Which zones a prop suits, so scatter never puts a crane in a park. */
export const PROP_TAGS: Record<PropId, string[]> = Object.fromEntries(
  PROP_IDS.map((id) => {
    if (id.includes('Signal') || id.includes('Catenary') || id.includes('Track') || id.includes('Buffer') || id.includes('Mile') || id.includes('Relay')) {
      return [id, ['rail']];
    }
    if (id.includes('Scaffold') || id.includes('Crane') || id.includes('Cement') || id.includes('Sand') || id.includes('Portaloo') || id.includes('Skip') || id.includes('Cone')) {
      return [id, ['construction']];
    }
    if (id.includes('Tank') || id.includes('Chimney') || id.includes('Conveyor') || id.includes('Drum') || id.includes('Transformer') || id.includes('Pallet')) {
      return [id, ['industrial']];
    }
    return [id, ['street']];
  }),
) as Record<PropId, string[]>;

function pole(height: number, radius = 0.07, mat = material('MAT_PaintedMetalDark')): THREE.Mesh {
  const mesh = new THREE.Mesh(new THREE.CylinderGeometry(radius * 0.85, radius, height, 8), mat);
  mesh.position.y = height / 2;
  mesh.castShadow = true;
  return mesh;
}

function lamp(color: 'MAT_NeonAmber' | 'MAT_NeonCyan' | 'MAT_Headlight'): THREE.Mesh {
  return new THREE.Mesh(new THREE.SphereGeometry(0.12, 8, 6), material(color));
}

function signPanel(width: number, height: number, mat = material('MAT_Signage')): THREE.Mesh {
  return new THREE.Mesh(roundedBox(width, height, 0.06, 0.03, 2), mat);
}

/** Builds one prop. Callers pool the result by id. */
export function buildProp(id: PropId): THREE.Group {
  const g = new THREE.Group();
  g.name = id;

  switch (id) {
    case 'PROP_SignalGantry': {
      const span = 9;
      for (const side of [-1, 1]) {
        const leg = pole(6.2, 0.11);
        leg.position.x = side * span / 2;
        g.add(leg);
      }
      const beam = new THREE.Mesh(
        place(new THREE.BoxGeometry(span, 0.32, 0.32), [0, 6.1, 0]),
        material('MAT_PaintedMetalDark'),
      );
      g.add(beam);
      // Lattice bracing along the beam.
      for (let i = 0; i < 8; i++) {
        const brace = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.06, 1.0), material('MAT_PaintedMetalDark'));
        brace.position.set(-span / 2 + (i + 0.5) * (span / 8), 5.85, 0);
        brace.rotation.x = Math.PI / 2;
        brace.rotation.z = i % 2 ? 0.5 : -0.5;
        g.add(brace);
      }
      for (let i = 0; i < 3; i++) {
        const head = new THREE.Mesh(roundedBox(0.4, 1.15, 0.34, 0.06, 2), material('MAT_PaintedMetalDark'));
        head.position.set(-2.6 + i * 2.6, 5.35, 0.2);
        g.add(head);
        for (let l = 0; l < 3; l++) {
          const bulb = new THREE.Mesh(
            new THREE.CircleGeometry(0.1, 10),
            material(l === 0 ? 'MAT_TailLight' : l === 1 ? 'MAT_NeonAmber' : 'MAT_NeonCyan'),
          );
          bulb.position.set(-2.6 + i * 2.6, 5.72 - l * 0.34, 0.38);
          g.add(bulb);
        }
      }
      break;
    }
    case 'PROP_SignalPost': {
      g.add(pole(3.6, 0.08));
      const head = new THREE.Mesh(roundedBox(0.36, 1.05, 0.3, 0.05, 2), material('MAT_PaintedMetalDark'));
      head.position.set(0, 3.5, 0.14);
      g.add(head);
      for (let l = 0; l < 3; l++) {
        const bulb = new THREE.Mesh(
          new THREE.CircleGeometry(0.09, 10),
          material(l === 0 ? 'MAT_TailLight' : l === 1 ? 'MAT_NeonAmber' : 'MAT_NeonCyan'),
        );
        bulb.position.set(0, 3.82 - l * 0.32, 0.3);
        g.add(bulb);
      }
      const ladder = new THREE.Mesh(new THREE.BoxGeometry(0.24, 3.2, 0.04), material('MAT_StainlessSteel'));
      ladder.position.set(0.16, 1.7, -0.1);
      g.add(ladder);
      break;
    }
    case 'PROP_CatenaryMast': {
      g.add(pole(7.4, 0.13));
      const arm = new THREE.Mesh(new THREE.BoxGeometry(2.6, 0.12, 0.12), material('MAT_PaintedMetalDark'));
      arm.position.set(-1.3, 7.1, 0);
      g.add(arm);
      const insulator = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 0.3, 8), material('MAT_Plastic'));
      insulator.position.set(-2.4, 6.9, 0);
      g.add(insulator);
      break;
    }
    case 'PROP_CatenaryPortal': {
      for (const side of [-1, 1]) {
        const leg = pole(7.6, 0.14);
        leg.position.x = side * 5.6;
        g.add(leg);
      }
      const top = new THREE.Mesh(new THREE.BoxGeometry(11.4, 0.26, 0.26), material('MAT_PaintedMetalDark'));
      top.position.y = 7.5;
      g.add(top);
      for (let i = 0; i < 3; i++) {
        const drop = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.9, 5), material('MAT_Cable'));
        drop.position.set(-2.4 + i * 2.4, 6.95, 0);
        g.add(drop);
      }
      break;
    }
    case 'PROP_RelayCabinet': {
      const box = new THREE.Mesh(roundedBox(1.1, 1.6, 0.6, 0.05, 2), material('MAT_PaintedMetal'));
      box.position.y = 0.8;
      box.castShadow = true;
      g.add(box);
      const plinth = new THREE.Mesh(new THREE.BoxGeometry(1.25, 0.14, 0.75), material('MAT_Concrete'));
      plinth.position.y = 0.07;
      g.add(plinth);
      const label = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 0.5), decal('DEC_Numbers'));
      label.position.set(0, 1.15, 0.31);
      g.add(label);
      break;
    }
    case 'PROP_JunctionBox': {
      const box = new THREE.Mesh(roundedBox(0.7, 0.55, 0.4, 0.04, 2), material('MAT_PaintedMetalDark'));
      box.position.y = 0.4;
      g.add(box);
      break;
    }
    case 'PROP_MilePost': {
      g.add(pole(1.1, 0.045, material('MAT_StainlessSteel')));
      const plate = signPanel(0.4, 0.3, material('MAT_PaintedWall'));
      plate.position.set(0, 1.2, 0);
      g.add(plate);
      break;
    }
    case 'PROP_SpeedSign': {
      g.add(pole(2.1, 0.05));
      const disc = new THREE.Mesh(new THREE.CylinderGeometry(0.38, 0.38, 0.05, 16), material('MAT_PaintedWall'));
      disc.rotation.x = Math.PI / 2;
      disc.position.y = 2.3;
      g.add(disc);
      break;
    }
    case 'PROP_WarningBoard': {
      g.add(pole(1.8, 0.05));
      const panel = signPanel(0.9, 0.7, material('MAT_SafetyYellow'));
      panel.position.y = 2.1;
      g.add(panel);
      const face = new THREE.Mesh(new THREE.PlaneGeometry(0.8, 0.6), decal('DEC_WarningStripes'));
      face.position.set(0, 2.1, 0.04);
      g.add(face);
      break;
    }
    case 'PROP_Fence': {
      const rail = new THREE.BoxGeometry(4, 0.08, 0.08);
      for (const y of [0.55, 1.05]) {
        const r = new THREE.Mesh(rail, material('MAT_PaintedMetalDark'));
        r.position.y = y;
        g.add(r);
      }
      for (let i = 0; i < 3; i++) {
        const post = pole(1.2, 0.05);
        post.position.x = -2 + i * 2;
        g.add(post);
      }
      break;
    }
    case 'PROP_MeshFence': {
      const frame = new THREE.Mesh(new THREE.BoxGeometry(4, 2.1, 0.06), material('MAT_StainlessSteel'));
      frame.position.y = 1.05;
      frame.material.transparent = true;
      g.add(frame);
      // Vertical wires give it a chain-link read without a texture.
      const wire = new THREE.BoxGeometry(0.02, 2.1, 0.02);
      const wires = new THREE.InstancedMesh(wire, material('MAT_StainlessSteel'), 20);
      const m = new THREE.Matrix4();
      for (let i = 0; i < 20; i++) {
        m.makeTranslation(-2 + i * 0.21, 1.05, 0);
        wires.setMatrixAt(i, m);
      }
      wires.instanceMatrix.needsUpdate = true;
      g.add(wires);
      for (const x of [-2, 2]) {
        const post = pole(2.3, 0.06);
        post.position.x = x;
        g.add(post);
      }
      break;
    }
    case 'PROP_Gate': {
      for (const x of [-1.5, 1.5]) {
        const post = pole(2.4, 0.09);
        post.position.x = x;
        g.add(post);
      }
      const leaf = new THREE.Mesh(new THREE.BoxGeometry(2.8, 1.9, 0.06), material('MAT_PaintedMetal'));
      leaf.position.set(0, 1.1, 0);
      g.add(leaf);
      break;
    }
    case 'PROP_CCTV': {
      g.add(pole(4.2, 0.07));
      const arm = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.06, 0.06), material('MAT_PaintedMetalDark'));
      arm.position.set(0.35, 4.15, 0);
      g.add(arm);
      const cam = new THREE.Mesh(roundedBox(0.42, 0.2, 0.2, 0.05, 2), material('MAT_PlasticDark'));
      cam.position.set(0.72, 4.05, 0);
      g.add(cam);
      const lens = new THREE.Mesh(new THREE.CircleGeometry(0.06, 8), material('MAT_Glass'));
      lens.position.set(0.94, 4.05, 0);
      lens.rotation.y = Math.PI / 2;
      g.add(lens);
      break;
    }
    case 'PROP_FirePoint': {
      const board = signPanel(0.8, 1.0, material('MAT_SafetyOrange'));
      board.position.y = 1.2;
      g.add(board);
      g.add(pole(0.75, 0.05));
      for (const x of [-0.2, 0.2]) {
        const ext = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 0.52, 10), material('MAT_TailLight'));
        ext.position.set(x, 1.05, 0.16);
        g.add(ext);
      }
      break;
    }
    case 'PROP_TrackLamp': {
      g.add(pole(4.6, 0.08));
      const head = new THREE.Mesh(roundedBox(0.7, 0.2, 0.34, 0.06, 2), material('MAT_PaintedMetal'));
      head.position.set(0.28, 4.6, 0);
      g.add(head);
      const bulb = lamp('MAT_NeonAmber');
      bulb.scale.set(2.4, 0.5, 1.2);
      bulb.position.set(0.28, 4.48, 0);
      g.add(bulb);
      // And the light it actually throws. See LightPool for why this is a
      // puddle rather than a light: lamps are streamed decor, and a light that
      // comes and goes with them changes the scene's light count.
      const pool = lightPool(5.2, 5.2);
      pool.position.x = 0.28;
      g.add(pool);
      break;
    }
    case 'PROP_BufferStop': {
      const body = new THREE.Mesh(roundedBox(2.3, 1.1, 0.9, 0.08, 2), material('MAT_HazardStripe'));
      body.position.y = 0.6;
      g.add(body);
      const beam = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.22, 0.22), material('MAT_RustedMetal'));
      beam.position.set(0, 1.2, -0.4);
      g.add(beam);
      break;
    }

    case 'PROP_StreetLight': {
      g.add(pole(6.4, 0.1));
      const arm = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.1, 1.8), material('MAT_PaintedMetalDark'));
      arm.position.set(0, 6.35, 0.9);
      g.add(arm);
      const head = new THREE.Mesh(roundedBox(0.38, 0.16, 0.9, 0.06, 2), material('MAT_BrushedAlu'));
      head.position.set(0, 6.2, 1.72);
      g.add(head);
      const glow = new THREE.Mesh(new THREE.PlaneGeometry(0.34, 0.82), material('MAT_NeonAmber'));
      glow.rotation.x = -Math.PI / 2;
      glow.position.set(0, 6.1, 1.72);
      g.add(glow);
      // A six-metre street light that lit nothing at all: the glow plane above
      // is the lamp's own face, not what it casts. The pool is offset to sit
      // under the arm rather than the pole, which is where a street light
      // actually puts its light.
      const cast = lightPool(7.4, 7.4);
      cast.position.z = 1.72;
      g.add(cast);
      break;
    }
    case 'PROP_TrafficLight': {
      g.add(pole(3.4, 0.08));
      const head = new THREE.Mesh(roundedBox(0.36, 1.05, 0.3, 0.05, 2), material('MAT_PlasticDark'));
      head.position.set(0, 3.5, 0.1);
      g.add(head);
      const colors: Array<'MAT_TailLight' | 'MAT_NeonAmber' | 'MAT_Boost'> = ['MAT_TailLight', 'MAT_NeonAmber', 'MAT_Boost'];
      colors.forEach((c, i) => {
        const bulb = new THREE.Mesh(new THREE.CircleGeometry(0.09, 10), material(c));
        bulb.position.set(0, 3.83 - i * 0.32, 0.26);
        g.add(bulb);
      });
      break;
    }
    case 'PROP_RoadSign': {
      g.add(pole(2.6, 0.06));
      const panel = signPanel(1.5, 0.5);
      panel.position.y = 2.75;
      g.add(panel);
      const face = new THREE.Mesh(new THREE.PlaneGeometry(1.4, 0.44), decal('DEC_Arrow'));
      face.position.set(0, 2.75, 0.04);
      g.add(face);
      break;
    }
    case 'PROP_Billboard': {
      for (const x of [-2.4, 2.4]) {
        const leg = pole(5.2, 0.11);
        leg.position.x = x;
        g.add(leg);
      }
      const board = new THREE.Mesh(roundedBox(6.4, 3.2, 0.22, 0.06, 2), material('MAT_Billboard'));
      board.position.y = 6.6;
      board.castShadow = true;
      g.add(board);
      const frame = new THREE.Mesh(new THREE.BoxGeometry(6.7, 0.16, 0.3), material('MAT_PaintedMetalDark'));
      frame.position.y = 8.3;
      g.add(frame);
      break;
    }
    case 'PROP_Poster': {
      const board = new THREE.Mesh(roundedBox(1.4, 2.0, 0.1, 0.03, 2), material('MAT_PaintedMetalDark'));
      board.position.y = 1.4;
      g.add(board);
      const face = new THREE.Mesh(new THREE.PlaneGeometry(1.25, 1.85), decal('DEC_Ad'));
      face.position.set(0, 1.4, 0.06);
      g.add(face);
      break;
    }
    case 'PROP_Bench': {
      const slat = new THREE.BoxGeometry(1.9, 0.06, 0.12);
      for (let i = 0; i < 3; i++) {
        const s = new THREE.Mesh(slat, material('MAT_Wood'));
        s.position.set(0, 0.46, -0.16 + i * 0.16);
        g.add(s);
      }
      for (let i = 0; i < 3; i++) {
        const s = new THREE.Mesh(slat, material('MAT_Wood'));
        s.position.set(0, 0.66 + i * 0.16, 0.22);
        s.rotation.x = -0.28;
        g.add(s);
      }
      for (const x of [-0.82, 0.82]) {
        const legMesh = new THREE.Mesh(roundedBox(0.08, 0.46, 0.5, 0.02, 1), material('MAT_PaintedMetalDark'));
        legMesh.position.set(x, 0.23, 0);
        g.add(legMesh);
      }
      break;
    }
    case 'PROP_Bin': {
      const body = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.24, 0.85, 12), material('MAT_PaintedMetalDark'));
      body.position.y = 0.43;
      g.add(body);
      const lid = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.3, 0.07, 12), material('MAT_StainlessSteel'));
      lid.position.y = 0.89;
      g.add(lid);
      break;
    }
    case 'PROP_UtilityBox': {
      const body = new THREE.Mesh(roundedBox(1.0, 1.2, 0.5, 0.05, 2), material('MAT_PaintedMetal'));
      body.position.y = 0.6;
      g.add(body);
      const graffiti = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 1.0), decal('DEC_Graffiti'));
      graffiti.position.set(0, 0.62, 0.26);
      g.add(graffiti);
      break;
    }
    case 'PROP_AcUnit': {
      const body = new THREE.Mesh(roundedBox(0.9, 0.7, 0.4, 0.05, 2), material('MAT_BrushedAlu'));
      body.position.y = 0.35;
      g.add(body);
      const fan = new THREE.Mesh(new THREE.CircleGeometry(0.24, 12), material('MAT_PlasticDark'));
      fan.position.set(0, 0.35, 0.21);
      g.add(fan);
      const bracket = new THREE.Mesh(new THREE.BoxGeometry(1.0, 0.05, 0.5), material('MAT_RustedMetal'));
      bracket.position.y = -0.02;
      g.add(bracket);
      break;
    }
    case 'PROP_PipeRun': {
      for (let i = 0; i < 3; i++) {
        const pipe = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.11, 6, 10), material('MAT_RustedMetal'));
        pipe.rotation.x = Math.PI / 2;
        pipe.position.set(0, 2.4 + i * 0.3, 0);
        g.add(pipe);
      }
      for (const z of [-2.4, 2.4]) {
        const bracket = new THREE.Mesh(new THREE.BoxGeometry(0.1, 1.2, 0.1), material('MAT_PaintedMetalDark'));
        bracket.position.set(0, 2.4, z);
        g.add(bracket);
      }
      break;
    }
    case 'PROP_Generator': {
      const body = new THREE.Mesh(roundedBox(2.2, 1.3, 1.1, 0.07, 2), material('MAT_SafetyYellow'));
      body.position.y = 0.75;
      g.add(body);
      const exhaust = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 0.8, 8), material('MAT_RustedMetal'));
      exhaust.position.set(0.85, 1.7, 0);
      g.add(exhaust);
      const skid = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.14, 1.25), material('MAT_PaintedMetalDark'));
      skid.position.y = 0.09;
      g.add(skid);
      break;
    }
    case 'PROP_Hydrant': {
      const body = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.15, 0.7, 10), material('MAT_TailLight'));
      body.position.y = 0.35;
      g.add(body);
      const cap = new THREE.Mesh(new THREE.SphereGeometry(0.13, 8, 6), material('MAT_TailLight'));
      cap.position.y = 0.72;
      g.add(cap);
      for (const side of [-1, 1]) {
        const nozzle = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.18, 8), material('MAT_TailLight'));
        nozzle.rotation.z = Math.PI / 2;
        nozzle.position.set(side * 0.15, 0.5, 0);
        g.add(nozzle);
      }
      break;
    }
    case 'PROP_Bollard': {
      const body = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.11, 0.95, 10), material('MAT_PaintedMetalDark'));
      body.position.y = 0.48;
      g.add(body);
      const band = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 0.1, 10), material('MAT_SafetyYellow'));
      band.position.y = 0.82;
      g.add(band);
      break;
    }
    case 'PROP_PhoneBox': {
      const body = new THREE.Mesh(roundedBox(1.0, 2.3, 1.0, 0.08, 2), material('MAT_TailLight'));
      body.position.y = 1.15;
      g.add(body);
      const glassPane = new THREE.Mesh(new THREE.PlaneGeometry(0.8, 1.7), material('MAT_Glass'));
      glassPane.position.set(0, 1.3, 0.51);
      g.add(glassPane);
      break;
    }
    case 'PROP_VendingStall': {
      const counter = new THREE.Mesh(roundedBox(2.4, 1.1, 1.2, 0.06, 2), material('MAT_Plastic'));
      counter.position.y = 0.55;
      g.add(counter);
      const canopy = new THREE.Mesh(roundedBox(2.8, 0.1, 1.6, 0.04, 2), material('MAT_SafetyOrange'));
      canopy.position.y = 2.3;
      g.add(canopy);
      for (const x of [-1.2, 1.2]) {
        const post = pole(2.3, 0.05, material('MAT_StainlessSteel'));
        post.position.x = x;
        g.add(post);
      }
      const sign = new THREE.Mesh(new THREE.PlaneGeometry(2.2, 0.5), decal('DEC_Ad'));
      sign.position.set(0, 1.9, 0.62);
      g.add(sign);
      break;
    }
    case 'PROP_Awning': {
      const canopy = new THREE.Mesh(roundedBox(3.6, 0.12, 1.5, 0.05, 2), material('MAT_SafetyOrange'));
      canopy.position.set(0, 3.0, 0.75);
      canopy.rotation.x = -0.12;
      g.add(canopy);
      for (const x of [-1.6, 1.6]) {
        const stay = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.06, 1.6), material('MAT_PaintedMetalDark'));
        stay.position.set(x, 3.15, 0.7);
        stay.rotation.x = 0.4;
        g.add(stay);
      }
      break;
    }

    case 'PROP_Scaffold': {
      const tubeGeo = new THREE.CylinderGeometry(0.045, 0.045, 6, 6);
      const mat = material('MAT_StainlessSteel');
      for (let x = -1; x <= 1; x++) {
        for (let z = -1; z <= 1; z += 2) {
          const t = new THREE.Mesh(tubeGeo, mat);
          t.position.set(x * 1.6, 3, z * 0.8);
          g.add(t);
        }
      }
      for (let level = 1; level <= 3; level++) {
        const rail = new THREE.Mesh(new THREE.BoxGeometry(3.4, 0.05, 0.05), mat);
        rail.position.set(0, level * 1.8, -0.8);
        g.add(rail);
        const deck = new THREE.Mesh(new THREE.BoxGeometry(3.3, 0.06, 1.5), material('MAT_WoodWorn'));
        deck.position.set(0, level * 1.8 - 0.05, 0);
        g.add(deck);
      }
      break;
    }
    case 'PROP_Crane': {
      const mast = new THREE.Mesh(new THREE.BoxGeometry(1.1, 22, 1.1), material('MAT_SafetyYellow'));
      mast.position.y = 11;
      g.add(mast);
      const jib = new THREE.Mesh(new THREE.BoxGeometry(20, 0.8, 0.9), material('MAT_SafetyYellow'));
      jib.position.set(6, 22.4, 0);
      g.add(jib);
      const counterJib = new THREE.Mesh(new THREE.BoxGeometry(6, 0.8, 0.9), material('MAT_SafetyYellow'));
      counterJib.position.set(-5, 22.4, 0);
      g.add(counterJib);
      const weight = new THREE.Mesh(new THREE.BoxGeometry(1.6, 1.4, 1.4), material('MAT_Concrete'));
      weight.position.set(-7.4, 22, 0);
      g.add(weight);
      const hook = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 9, 5), material('MAT_Cable'));
      hook.position.set(9, 17.6, 0);
      g.add(hook);
      const base = new THREE.Mesh(new THREE.BoxGeometry(4, 0.6, 4), material('MAT_Concrete'));
      base.position.y = 0.3;
      g.add(base);
      break;
    }
    case 'PROP_CementMixer': {
      const drum = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.4, 1.2, 12), material('MAT_SafetyOrange'));
      drum.rotation.z = 0.5;
      drum.position.set(0, 1.1, 0);
      g.add(drum);
      const frameMesh = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.1, 1.2), material('MAT_PaintedMetalDark'));
      frameMesh.position.y = 0.5;
      g.add(frameMesh);
      for (const x of [-0.5, 0.5]) {
        const wheel = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.22, 0.1, 10), material('MAT_Rubber'));
        wheel.rotation.z = Math.PI / 2;
        wheel.position.set(x, 0.22, 0.4);
        g.add(wheel);
      }
      break;
    }
    case 'PROP_PipeStack': {
      const pipeGeo = new THREE.CylinderGeometry(0.24, 0.24, 3.2, 10);
      const mat = material('MAT_Concrete');
      let n = 0;
      for (let row = 0; row < 3; row++) {
        for (let i = 0; i < 3 - row; i++) {
          const p = new THREE.Mesh(pipeGeo, mat);
          p.rotation.x = Math.PI / 2;
          p.position.set(-0.5 + row * 0.24 + i * 0.5, 0.24 + row * 0.42, 0);
          g.add(p);
          n++;
        }
      }
      void n;
      break;
    }
    case 'PROP_SandPile': {
      const pile = new THREE.Mesh(new THREE.ConeGeometry(1.6, 1.1, 12), material('MAT_Dirt'));
      pile.position.y = 0.55;
      g.add(pile);
      break;
    }
    case 'PROP_Portaloo': {
      const body = new THREE.Mesh(roundedBox(1.1, 2.3, 1.1, 0.06, 2), material('MAT_Plastic'));
      body.position.y = 1.15;
      body.material = material('MAT_Boost');
      g.add(body);
      const door = new THREE.Mesh(new THREE.BoxGeometry(0.8, 1.9, 0.06), material('MAT_PlasticDark'));
      door.position.set(0, 1.1, 0.57);
      g.add(door);
      break;
    }
    case 'PROP_SkipBin': {
      const shape = new THREE.Shape();
      shape.moveTo(-1.6, 0); shape.lineTo(1.6, 0); shape.lineTo(1.9, 1.1); shape.lineTo(-1.9, 1.1); shape.closePath();
      const geo = new THREE.ExtrudeGeometry(shape, { depth: 1.8, bevelEnabled: false });
      geo.translate(0, 0, -0.9);
      const body = new THREE.Mesh(geo, material('MAT_RustedMetal'));
      g.add(body);
      break;
    }
    case 'PROP_TrafficCone': {
      const cone = new THREE.Mesh(new THREE.ConeGeometry(0.22, 0.7, 10), material('MAT_SafetyOrange'));
      cone.position.y = 0.35;
      g.add(cone);
      const base = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.05, 0.42), material('MAT_PlasticDark'));
      base.position.y = 0.03;
      g.add(base);
      break;
    }

    case 'PROP_Tank': {
      const body = new THREE.Mesh(new THREE.CylinderGeometry(2.2, 2.2, 5.5, 18), material('MAT_PaintedMetal'));
      body.position.y = 2.75;
      g.add(body);
      const top = new THREE.Mesh(new THREE.SphereGeometry(2.2, 18, 8, 0, Math.PI * 2, 0, Math.PI / 2), material('MAT_PaintedMetal'));
      top.position.y = 5.5;
      g.add(top);
      const ladder = new THREE.Mesh(new THREE.BoxGeometry(0.4, 5.4, 0.06), material('MAT_StainlessSteel'));
      ladder.position.set(2.2, 2.7, 0);
      g.add(ladder);
      break;
    }
    case 'PROP_Chimney': {
      const stack = new THREE.Mesh(new THREE.CylinderGeometry(0.9, 1.4, 16, 14), material('MAT_Brick'));
      stack.position.y = 8;
      g.add(stack);
      const band = new THREE.Mesh(new THREE.CylinderGeometry(0.95, 0.95, 0.4, 14), material('MAT_PaintedWall'));
      band.position.y = 14.5;
      g.add(band);
      break;
    }
    case 'PROP_Conveyor': {
      const belt = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.14, 9), material('MAT_Rubber'));
      belt.position.set(0, 2.6, 0);
      belt.rotation.x = 0.22;
      g.add(belt);
      for (let i = 0; i < 4; i++) {
        const leg = pole(2.4 + i * 0.5, 0.07);
        leg.position.z = -3.4 + i * 2.2;
        g.add(leg);
      }
      break;
    }
    case 'PROP_Pallets': {
      const plank = new THREE.BoxGeometry(1.2, 0.05, 0.9);
      for (let i = 0; i < 4; i++) {
        const p = new THREE.Mesh(plank, material('MAT_WoodWorn'));
        p.position.y = 0.06 + i * 0.14;
        g.add(p);
      }
      break;
    }
    case 'PROP_Drum': {
      const body = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.32, 0.9, 14), material('MAT_RustedMetal'));
      body.position.y = 0.45;
      g.add(body);
      for (const y of [0.25, 0.65]) {
        const rib = new THREE.Mesh(new THREE.TorusGeometry(0.33, 0.025, 5, 14), material('MAT_RustedMetal'));
        rib.rotation.x = Math.PI / 2;
        rib.position.y = y;
        g.add(rib);
      }
      break;
    }
    case 'PROP_Ventilator': {
      const housing = new THREE.Mesh(roundedBox(1.6, 1.0, 1.6, 0.08, 2), material('MAT_BrushedAlu'));
      housing.position.y = 0.5;
      g.add(housing);
      const cowl = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.7, 0.5, 12), material('MAT_BrushedAlu'));
      cowl.position.y = 1.25;
      g.add(cowl);
      const blades = new THREE.Mesh(new THREE.CircleGeometry(0.5, 12), material('MAT_PlasticDark'));
      blades.rotation.x = -Math.PI / 2;
      blades.position.y = 1.5;
      g.add(blades);
      break;
    }
    case 'PROP_Transformer': {
      const body = new THREE.Mesh(roundedBox(1.8, 1.9, 1.2, 0.06, 2), material('MAT_PaintedMetal'));
      body.position.y = 1.05;
      g.add(body);
      for (let i = 0; i < 3; i++) {
        const bushing = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.13, 0.7, 8), material('MAT_Plastic'));
        bushing.position.set(-0.5 + i * 0.5, 2.3, 0);
        g.add(bushing);
      }
      const fence = new THREE.Mesh(new THREE.BoxGeometry(3, 1.6, 0.05), material('MAT_StainlessSteel'));
      fence.position.set(0, 0.8, 1.1);
      fence.material.transparent = true;
      g.add(fence);
      break;
    }
    case 'PROP_Ladder': {
      for (const x of [-0.24, 0.24]) {
        const rail = new THREE.Mesh(new THREE.BoxGeometry(0.06, 4.2, 0.06), material('MAT_StainlessSteel'));
        rail.position.set(x, 2.1, 0);
        g.add(rail);
      }
      const rungGeo = new THREE.CylinderGeometry(0.025, 0.025, 0.5, 6);
      const rungs = new THREE.InstancedMesh(rungGeo, material('MAT_StainlessSteel'), 13);
      const m = new THREE.Matrix4();
      const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), Math.PI / 2);
      for (let i = 0; i < 13; i++) {
        m.compose(new THREE.Vector3(0, 0.3 + i * 0.3, 0), q, new THREE.Vector3(1, 1, 1));
        rungs.setMatrixAt(i, m);
      }
      rungs.instanceMatrix.needsUpdate = true;
      g.add(rungs);
      break;
    }
  }

  g.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (mesh.isMesh) {
      mesh.castShadow = true;
      mesh.receiveShadow = true;
    }
  });
  // Props are static, so collapse them to one mesh per material: a signal
  // gantry drops from 15 draw calls to 3.
  return mergeByMaterial(g) as THREE.Group;
}

/** Merged low-detail silhouette used for props far from the camera. */
export function buildPropImpostor(id: PropId): THREE.Mesh {
  const full = buildProp(id);
  const box = new THREE.Box3().setFromObject(full);
  const size = new THREE.Vector3();
  const centre = new THREE.Vector3();
  box.getSize(size);
  box.getCenter(centre);
  const geo = place(new THREE.BoxGeometry(size.x, size.y, size.z), [centre.x, centre.y, centre.z]);
  const mesh = new THREE.Mesh(mergeGeometries([geo]), material('MAT_ConcreteDirty'));
  mesh.name = `${id}_LOD2`;
  full.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.isMesh) m.geometry.dispose();
  });
  return mesh;
}
