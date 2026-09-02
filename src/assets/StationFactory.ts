import * as THREE from 'three';
import { hash01, mergeByMaterial, place, roundedBox } from './GeometryUtil';
import { decal, material } from './MaterialLibrary';
import { TRACK_HALF_WIDTH } from './TrackFactory';

/**
 * STA_* modular station kit. Pieces snap to the platform grid so the
 * generator can assemble a different station every time without authoring one.
 */

export type StationPiece =
  | 'STA_PlatformRoof' | 'STA_Pillar' | 'STA_Stairs' | 'STA_Escalator'
  | 'STA_TicketGate' | 'STA_TicketMachine' | 'STA_DigitalBoard' | 'STA_Signage'
  | 'STA_Bench' | 'STA_AdPanel' | 'STA_Railing' | 'STA_Entrance'
  | 'STA_Wall' | 'STA_Kiosk' | 'STA_Clock' | 'STA_Lighting';

export const STATION_PIECES: StationPiece[] = [
  'STA_PlatformRoof', 'STA_Pillar', 'STA_Stairs', 'STA_Escalator',
  'STA_TicketGate', 'STA_TicketMachine', 'STA_DigitalBoard', 'STA_Signage',
  'STA_Bench', 'STA_AdPanel', 'STA_Railing', 'STA_Entrance',
  'STA_Wall', 'STA_Kiosk', 'STA_Clock', 'STA_Lighting',
];

export function buildStationPiece(piece: StationPiece): THREE.Group {
  const g = new THREE.Group();
  g.name = piece;

  switch (piece) {
    case 'STA_PlatformRoof': {
      // A cantilevered canopy: spine beam, ribs and a translucent deck.
      const spine = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.4, 24), material('MAT_PaintedMetal'));
      spine.position.y = 4.6;
      g.add(spine);
      for (let i = 0; i < 9; i++) {
        const rib = new THREE.Mesh(new THREE.BoxGeometry(7.2, 0.16, 0.18), material('MAT_PaintedMetal'));
        rib.position.set(0, 4.5, -11 + i * 2.75);
        rib.rotation.z = 0.06;
        g.add(rib);
      }
      const deck = new THREE.Mesh(place(new THREE.BoxGeometry(7.4, 0.08, 24), [0, 4.68, 0]), material('MAT_GlassTinted'));
      g.add(deck);
      const fascia = new THREE.Mesh(place(new THREE.BoxGeometry(0.12, 0.5, 24), [3.6, 4.4, 0]), material('MAT_BrushedAlu'));
      g.add(fascia);
      break;
    }
    case 'STA_Pillar': {
      const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.24, 0.3, 4.4, 12), material('MAT_StainlessSteel'));
      shaft.position.y = 2.2;
      g.add(shaft);
      const capital = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.26, 0.5, 12), material('MAT_PaintedMetal'));
      capital.position.y = 4.55;
      g.add(capital);
      const base = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.42, 0.16, 12), material('MAT_Concrete'));
      base.position.y = 0.08;
      g.add(base);
      break;
    }
    case 'STA_Stairs': {
      const steps = 14;
      for (let i = 0; i < steps; i++) {
        const step = new THREE.Mesh(new THREE.BoxGeometry(3.2, 0.18, 0.32), material('MAT_PlatformTile'));
        step.position.set(0, 0.09 + i * 0.19, -i * 0.32);
        g.add(step);
      }
      for (const side of [-1, 1]) {
        const rail = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.06, 5.2), material('MAT_StainlessSteel'));
        rail.position.set(side * 1.6, 1.5, -2.2);
        rail.rotation.x = -0.53;
        g.add(rail);
      }
      break;
    }
    case 'STA_Escalator': {
      const shape = new THREE.Shape();
      shape.moveTo(0, 0); shape.lineTo(5.6, 3.0); shape.lineTo(5.6, 3.5); shape.lineTo(0, 0.5); shape.closePath();
      const truss = new THREE.ExtrudeGeometry(shape, { depth: 1.3, bevelEnabled: false });
      truss.translate(0, 0, -0.65);
      truss.rotateY(Math.PI / 2);
      const body = new THREE.Mesh(truss, material('MAT_BrushedAlu'));
      g.add(body);
      // Moving step band, animated by the world updater via userData.
      const band = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.06, 6.4), material('MAT_PlatformEdge'));
      band.position.set(0, 1.8, 0);
      band.rotation.x = -0.49;
      band.userData.escalator = true;
      g.add(band);
      for (const side of [-1, 1]) {
        const balustrade = new THREE.Mesh(new THREE.BoxGeometry(0.06, 1.0, 6.4), material('MAT_GlassTinted'));
        balustrade.position.set(side * 0.66, 2.3, 0);
        balustrade.rotation.x = -0.49;
        g.add(balustrade);
      }
      break;
    }
    case 'STA_TicketGate': {
      for (const side of [-1, 1]) {
        const pedestal = new THREE.Mesh(roundedBox(0.34, 1.0, 1.5, 0.08, 2), material('MAT_BrushedAlu'));
        pedestal.position.set(side * 0.5, 0.5, 0);
        g.add(pedestal);
        const reader = new THREE.Mesh(new THREE.CircleGeometry(0.09, 10), material('MAT_NeonCyan'));
        reader.position.set(side * 0.34, 1.02, 0.3);
        reader.rotation.x = -Math.PI / 2;
        g.add(reader);
        const flap = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.7, 0.5), material('MAT_GlassTinted'));
        flap.position.set(side * 0.28, 0.62, 0.3);
        g.add(flap);
      }
      break;
    }
    case 'STA_TicketMachine': {
      const body = new THREE.Mesh(roundedBox(0.9, 1.8, 0.6, 0.06, 2), material('MAT_PaintedMetal'));
      body.position.y = 0.9;
      g.add(body);
      const screen = new THREE.Mesh(new THREE.PlaneGeometry(0.6, 0.45), material('MAT_LedPanel'));
      screen.position.set(0, 1.35, 0.31);
      screen.rotation.x = -0.25;
      g.add(screen);
      const tray = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.06, 0.12), material('MAT_PlasticDark'));
      tray.position.set(0, 0.85, 0.32);
      g.add(tray);
      break;
    }
    case 'STA_DigitalBoard': {
      const frame = new THREE.Mesh(roundedBox(4.2, 1.0, 0.16, 0.04, 2), material('MAT_PlasticDark'));
      frame.position.y = 3.4;
      g.add(frame);
      const screen = new THREE.Mesh(new THREE.PlaneGeometry(4.0, 0.85), material('MAT_LedPanel'));
      screen.position.set(0, 3.4, 0.09);
      g.add(screen);
      for (const x of [-1.8, 1.8]) {
        const hanger = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 1.2, 6), material('MAT_StainlessSteel'));
        hanger.position.set(x, 4.5, 0);
        g.add(hanger);
      }
      break;
    }
    case 'STA_Signage': {
      const panel = new THREE.Mesh(roundedBox(2.6, 0.6, 0.1, 0.04, 2), material('MAT_Signage'));
      panel.position.y = 3.0;
      g.add(panel);
      const arrow = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 0.5), decal('DEC_Arrow'));
      arrow.position.set(-0.95, 3.0, 0.06);
      g.add(arrow);
      break;
    }
    case 'STA_Bench': {
      const seat = new THREE.Mesh(roundedBox(2.4, 0.1, 0.55, 0.03, 2), material('MAT_StainlessSteel'));
      seat.position.y = 0.46;
      g.add(seat);
      for (const x of [-1.0, 1.0]) {
        const leg = new THREE.Mesh(roundedBox(0.1, 0.46, 0.5, 0.02, 1), material('MAT_BrushedAlu'));
        leg.position.set(x, 0.23, 0);
        g.add(leg);
      }
      const back = new THREE.Mesh(roundedBox(2.4, 0.5, 0.08, 0.03, 2), material('MAT_StainlessSteel'));
      back.position.set(0, 0.78, -0.24);
      back.rotation.x = 0.18;
      g.add(back);
      break;
    }
    case 'STA_AdPanel': {
      const frame = new THREE.Mesh(roundedBox(1.5, 2.3, 0.14, 0.04, 2), material('MAT_BrushedAlu'));
      frame.position.y = 1.4;
      g.add(frame);
      const face = new THREE.Mesh(new THREE.PlaneGeometry(1.3, 2.05), decal('DEC_Ad'));
      face.position.set(0, 1.4, 0.08);
      g.add(face);
      const backFace = face.clone();
      backFace.position.z = -0.08;
      backFace.rotation.y = Math.PI;
      g.add(backFace);
      break;
    }
    case 'STA_Railing': {
      const top = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 6, 8), material('MAT_StainlessSteel'));
      top.rotation.x = Math.PI / 2;
      top.position.y = 1.05;
      g.add(top);
      const glassPanel = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.85, 6), material('MAT_Glass'));
      glassPanel.position.y = 0.55;
      g.add(glassPanel);
      for (let i = 0; i < 4; i++) {
        const post = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 1.05, 8), material('MAT_StainlessSteel'));
        post.position.set(0, 0.52, -3 + i * 2);
        g.add(post);
      }
      break;
    }
    case 'STA_Entrance': {
      const portal = new THREE.Mesh(roundedBox(5.4, 4.4, 0.5, 0.12, 2), material('MAT_Concrete'));
      portal.position.y = 2.2;
      g.add(portal);
      const opening = new THREE.Mesh(new THREE.BoxGeometry(3.6, 3.2, 0.7), material('MAT_PlasticDark'));
      opening.position.y = 1.6;
      g.add(opening);
      const sign = new THREE.Mesh(new THREE.PlaneGeometry(4.4, 0.7), material('MAT_LedPanel'));
      sign.position.set(0, 3.8, 0.27);
      g.add(sign);
      break;
    }
    case 'STA_Wall': {
      const wall = new THREE.Mesh(place(new THREE.BoxGeometry(0.3, 5, 24), [0, 2.5, 0]), material('MAT_PlatformTile'));
      g.add(wall);
      for (let i = 0; i < 4; i++) {
        const grime = new THREE.Mesh(new THREE.PlaneGeometry(2.4, 2.4), decal(hash01(i) > 0.5 ? 'DEC_Dirt' : 'DEC_Graffiti'));
        grime.position.set(0.16, 1.6 + hash01(i * 3) * 1.4, -9 + i * 6);
        grime.rotation.y = Math.PI / 2;
        g.add(grime);
      }
      break;
    }
    case 'STA_Kiosk': {
      const body = new THREE.Mesh(roundedBox(2.6, 2.6, 2.0, 0.1, 2), material('MAT_PaintedWall'));
      body.position.y = 1.3;
      g.add(body);
      const window = new THREE.Mesh(new THREE.PlaneGeometry(1.8, 1.0), material('MAT_Glass'));
      window.position.set(0, 1.6, 1.01);
      g.add(window);
      const counter = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.1, 0.5), material('MAT_StainlessSteel'));
      counter.position.set(0, 1.05, 1.2);
      g.add(counter);
      const sign = new THREE.Mesh(new THREE.PlaneGeometry(2.2, 0.4), material('MAT_NeonMagenta'));
      sign.position.set(0, 2.35, 1.02);
      g.add(sign);
      break;
    }
    case 'STA_Clock': {
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.08, 3.4, 8), material('MAT_PaintedMetalDark'));
      post.position.y = 1.7;
      g.add(post);
      for (const side of [-1, 1]) {
        const face = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.42, 0.1, 16), material('MAT_LedPanel'));
        face.rotation.z = Math.PI / 2;
        face.position.set(side * 0.08, 3.5, 0);
        g.add(face);
      }
      break;
    }
    case 'STA_Lighting': {
      const bar = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.12, 3.6), material('MAT_BrushedAlu'));
      bar.position.y = 4.3;
      g.add(bar);
      const tube = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.06, 3.4), material('MAT_NeonAmber'));
      tube.position.y = 4.22;
      g.add(tube);
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
  return mergeByMaterial(g) as THREE.Group;
}

/**
 * Assembles a whole station from the kit: two platforms of furniture, a
 * canopy, vertical circulation and signage. Seeded so each one differs.
 */
export function buildStation(seed: number): THREE.Group {
  const station = new THREE.Group();
  station.name = 'STA_Assembly';
  const platformX = TRACK_HALF_WIDTH + 3.4;
  const deckY = 0.76;

  for (const side of [-1, 1]) {
    const x = side * platformX;

    const roof = buildStationPiece('STA_PlatformRoof');
    roof.position.set(x, deckY, 0);
    station.add(roof);

    for (let i = 0; i < 5; i++) {
      const pillar = buildStationPiece('STA_Pillar');
      pillar.position.set(x + side * 1.4, deckY, -10 + i * 5);
      station.add(pillar);
    }

    const lighting = buildStationPiece('STA_Lighting');
    lighting.position.set(x, deckY, 0);
    station.add(lighting);

    // Furniture placement varies per station.
    const layout: Array<[StationPiece, number, number]> = [
      ['STA_Bench', -8 + hash01(seed + side) * 3, 1.2],
      ['STA_Bench', 4 + hash01(seed + side * 2) * 3, 1.2],
      ['STA_AdPanel', -2.5, 2.1],
      ['STA_TicketMachine', 7.5, 2.0],
      ['STA_Signage', 0, 0],
      ['STA_Clock', -6, 0],
      ['STA_DigitalBoard', 2, 0],
    ];
    for (const [piece, z, inset] of layout) {
      const obj = buildStationPiece(piece);
      obj.position.set(x + side * inset, deckY, z);
      obj.rotation.y = side > 0 ? Math.PI : 0;
      station.add(obj);
    }

    const railing = buildStationPiece('STA_Railing');
    railing.position.set(x + side * 2.9, deckY, -6);
    station.add(railing);

    // Vertical circulation: stairs on one platform, an escalator on the other.
    const useEscalator = hash01(seed + (side > 0 ? 11 : 23)) > 0.5;
    const circulation = buildStationPiece(useEscalator ? 'STA_Escalator' : 'STA_Stairs');
    circulation.position.set(x + side * 1.8, deckY, 9);
    circulation.rotation.y = side > 0 ? Math.PI : 0;
    station.add(circulation);

    const gate = buildStationPiece('STA_TicketGate');
    gate.position.set(x + side * 2.2, deckY, 11.4);
    station.add(gate);

    const wall = buildStationPiece('STA_Wall');
    wall.position.set(x + side * 3.3, deckY, 0);
    station.add(wall);

    // The entrance is a portal *in* the back wall, facing across the platform.
    // It used to sit at x = 0 — a 5.4 m concrete facade planted across all
    // three running lines, with no collider, so the player ran through a
    // building that looked solid and hid the track ahead. Stations are
    // furniture beside the track; nothing here belongs inside the corridor.
    const entrance = buildStationPiece('STA_Entrance');
    entrance.position.set(x + side * 3.3, deckY, 13.5);
    entrance.rotation.y = -side * Math.PI / 2;
    station.add(entrance);
  }

  return station;
}
