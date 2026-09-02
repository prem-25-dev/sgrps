import * as THREE from 'three';
import { OBSTACLE_BY_ID } from '../../data/obstacles';
import { hash01, mergeByMaterial, place, roundedBox } from '../assets/GeometryUtil';
import { decal, material } from '../assets/MaterialLibrary';
import { buildTrain, TrainVariant } from '../assets/TrainFactory';
import { ObstacleDef } from '../core/Types';

/**
 * Builds the visual mesh for an obstacle archetype. The collider comes from
 * the metadata, never from this geometry, so art can be as detailed as the
 * budget allows without changing how the obstacle plays.
 */
export function buildObstacleMesh(def: ObstacleDef, seed = 1): THREE.Group {
  const g = new THREE.Group();
  g.name = def.id;

  switch (def.mesh) {
    case 'barrier': {
      // Crowd-control barrier: frame, mesh infill, feet.
      const top = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, def.width, 8), material('MAT_SafetyOrange'));
      top.rotation.z = Math.PI / 2;
      top.position.y = def.height - 0.06;
      g.add(top);
      const bottom = top.clone();
      bottom.position.y = def.height * 0.42;
      g.add(bottom);
      for (const side of [-1, 1]) {
        const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, def.height, 8), material('MAT_SafetyOrange'));
        leg.position.set(side * (def.width / 2 - 0.05), def.height / 2, 0);
        g.add(leg);
        const foot = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.06, 0.55), material('MAT_PaintedMetalDark'));
        foot.position.set(side * (def.width / 2 - 0.05), 0.03, 0);
        g.add(foot);
      }
      const infill = new THREE.Mesh(new THREE.BoxGeometry(def.width - 0.2, def.height * 0.5, 0.04), material('MAT_HazardStripe'));
      infill.position.y = def.height * 0.71;
      g.add(infill);
      break;
    }
    case 'barricade': {
      const plank = new THREE.BoxGeometry(def.width, 0.22, 0.09);
      for (let i = 0; i < 3; i++) {
        const p = new THREE.Mesh(plank, material('MAT_HazardStripe'));
        p.position.set(0, 0.35 + i * 0.32, 0);
        g.add(p);
      }
      for (const side of [-1, 1]) {
        const legMesh = new THREE.Mesh(new THREE.BoxGeometry(0.1, def.height, 0.1), material('MAT_WoodWorn'));
        legMesh.position.set(side * (def.width / 2 - 0.1), def.height / 2, 0);
        legMesh.rotation.x = side * 0.1;
        g.add(legMesh);
        const brace = new THREE.Mesh(new THREE.BoxGeometry(0.08, def.height * 1.05, 0.08), material('MAT_WoodWorn'));
        brace.position.set(side * (def.width / 2 - 0.1), def.height / 2, 0.28);
        brace.rotation.x = -0.4;
        g.add(brace);
      }
      const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.08, 8, 6), material('MAT_NeonAmber'));
      lamp.position.set(0, def.height + 0.06, 0);
      g.add(lamp);
      break;
    }
    case 'crate': {
      const body = new THREE.Mesh(roundedBox(def.width, def.height, def.depth, 0.04, 2), material('MAT_Wood'));
      body.position.y = def.height / 2;
      g.add(body);
      // Corner bracing.
      const edge = new THREE.BoxGeometry(def.width + 0.03, 0.07, 0.07);
      for (const y of [0.08, def.height - 0.08]) {
        for (const z of [-def.depth / 2, def.depth / 2]) {
          const e = new THREE.Mesh(edge, material('MAT_WoodWorn'));
          e.position.set(0, y, z);
          g.add(e);
        }
      }
      const stamp = new THREE.Mesh(new THREE.PlaneGeometry(def.width * 0.5, def.height * 0.4), decal('DEC_Numbers'));
      stamp.position.set(0, def.height * 0.55, def.depth / 2 + 0.01);
      g.add(stamp);
      break;
    }
    case 'crateStack': {
      const sizes = [[1.4, 0.7, 1.3], [1.0, 0.5, 0.9], [0.7, 0.4, 0.7]];
      let y = 0;
      sizes.forEach((s, i) => {
        const box = new THREE.Mesh(roundedBox(s[0], s[1], s[2], 0.03, 2), material(i % 2 ? 'MAT_WoodWorn' : 'MAT_Wood'));
        box.position.set((hash01(seed + i) - 0.5) * 0.16, y + s[1] / 2, (hash01(seed + i * 3) - 0.5) * 0.16);
        box.rotation.y = (hash01(seed + i * 5) - 0.5) * 0.25;
        g.add(box);
        y += s[1];
      });
      break;
    }
    case 'concreteBlock': {
      const body = new THREE.Mesh(roundedBox(def.width, def.height, def.depth, 0.06, 2), material('MAT_Concrete'));
      body.position.y = def.height / 2;
      g.add(body);
      const chamfer = new THREE.Mesh(new THREE.BoxGeometry(def.width, 0.14, def.depth * 0.5), material('MAT_ConcreteDirty'));
      chamfer.position.y = def.height - 0.07;
      g.add(chamfer);
      const stripe = new THREE.Mesh(new THREE.PlaneGeometry(def.width * 0.9, 0.3), decal('DEC_WarningStripes'));
      stripe.position.set(0, def.height * 0.6, def.depth / 2 + 0.01);
      g.add(stripe);
      break;
    }
    case 'lowWall': {
      const body = new THREE.Mesh(place(new THREE.BoxGeometry(def.width, def.height, def.depth), [0, def.height / 2, 0]), material('MAT_Brick'));
      g.add(body);
      const cap = new THREE.Mesh(place(new THREE.BoxGeometry(def.width + 0.1, 0.1, def.depth + 0.12), [0, def.height + 0.05, 0]), material('MAT_Stone'));
      g.add(cap);
      break;
    }
    case 'equipment': {
      const body = new THREE.Mesh(roundedBox(def.width, def.height * 0.8, def.depth, 0.07, 2), material('MAT_SafetyYellow'));
      body.position.y = def.height * 0.4;
      g.add(body);
      const panel = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.34, 0.05), material('MAT_PlasticDark'));
      panel.position.set(0, def.height * 0.55, def.depth / 2 + 0.02);
      g.add(panel);
      const handle = new THREE.Mesh(new THREE.TorusGeometry(0.2, 0.03, 5, 10, Math.PI), material('MAT_StainlessSteel'));
      handle.rotation.x = Math.PI / 2;
      handle.position.set(0, def.height * 0.82, 0);
      g.add(handle);
      break;
    }
    case 'sandbags': {
      let y = 0;
      for (let row = 0; row < 3; row++) {
        const count = 3 - Math.floor(row / 2);
        for (let i = 0; i < count; i++) {
          const bag = new THREE.Mesh(new THREE.SphereGeometry(0.3, 8, 6), material('MAT_Dirt'));
          bag.scale.set(1.1, 0.55, 0.8);
          bag.position.set(-0.6 + i * (1.2 / Math.max(1, count - 1)) + (row % 2) * 0.12, y + 0.16, 0);
          g.add(bag);
        }
        y += 0.3;
      }
      break;
    }
    case 'cableDrum': {
      const drum = new THREE.Mesh(new THREE.CylinderGeometry(def.height / 2, def.height / 2, def.width * 0.62, 16), material('MAT_Cable'));
      drum.rotation.z = Math.PI / 2;
      drum.position.y = def.height / 2;
      g.add(drum);
      for (const side of [-1, 1]) {
        const cheek = new THREE.Mesh(new THREE.CylinderGeometry(def.height / 2 + 0.05, def.height / 2 + 0.05, 0.07, 16), material('MAT_WoodWorn'));
        cheek.rotation.z = Math.PI / 2;
        cheek.position.set(side * def.width * 0.33, def.height / 2, 0);
        g.add(cheek);
      }
      break;
    }
    case 'toolbox': {
      const body = new THREE.Mesh(roundedBox(def.width, def.height * 0.75, def.depth, 0.05, 2), material('MAT_TailLight'));
      body.position.y = def.height * 0.375;
      g.add(body);
      const lid = new THREE.Mesh(roundedBox(def.width + 0.04, 0.12, def.depth + 0.04, 0.04, 2), material('MAT_PaintedMetalDark'));
      lid.position.y = def.height * 0.78;
      g.add(lid);
      break;
    }
    case 'trolley': {
      const deck = new THREE.Mesh(roundedBox(def.width, 0.12, def.depth, 0.03, 2), material('MAT_PaintedMetalDark'));
      deck.position.y = 0.5;
      g.add(deck);
      const load = new THREE.Mesh(roundedBox(def.width * 0.8, 0.5, def.depth * 0.7, 0.04, 2), material('MAT_Corrugated'));
      load.position.y = 0.8;
      g.add(load);
      const handle = new THREE.Mesh(new THREE.BoxGeometry(def.width * 0.9, 0.06, 0.06), material('MAT_StainlessSteel'));
      handle.position.set(0, 1.02, -def.depth / 2 + 0.1);
      g.add(handle);
      for (const x of [-1, 1]) {
        for (const z of [-1, 1]) {
          const wheel = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.22, 0.09, 10), material('MAT_Rubber'));
          wheel.rotation.z = Math.PI / 2;
          wheel.position.set(x * (def.width / 2 - 0.18), 0.22, z * (def.depth / 2 - 0.22));
          g.add(wheel);
        }
      }
      break;
    }
    case 'drum': {
      const body = new THREE.Mesh(new THREE.CylinderGeometry(def.height / 2, def.height / 2, def.width * 0.85, 14), material('MAT_RustedMetal'));
      body.rotation.z = Math.PI / 2;
      body.position.y = def.height / 2;
      g.add(body);
      for (const y of [-0.22, 0.22]) {
        const rib = new THREE.Mesh(new THREE.TorusGeometry(def.height / 2 + 0.02, 0.03, 5, 14), material('MAT_RustedMetal'));
        rib.rotation.y = Math.PI / 2;
        rib.position.set(y, def.height / 2, 0);
        g.add(rib);
      }
      break;
    }

    case 'beam': {
      const beam = new THREE.Mesh(roundedBox(def.width, def.height, def.depth, 0.04, 2), material('MAT_PaintedMetalDark'));
      beam.position.y = def.yOffset;
      g.add(beam);
      const stripe = new THREE.Mesh(new THREE.PlaneGeometry(def.width, def.height * 0.8), decal('DEC_WarningStripes'));
      stripe.position.set(0, def.yOffset, def.depth / 2 + 0.01);
      g.add(stripe);
      for (const side of [-1, 1]) {
        const hanger = new THREE.Mesh(new THREE.BoxGeometry(0.08, 1.6, 0.08), material('MAT_StainlessSteel'));
        hanger.position.set(side * (def.width / 2 - 0.1), def.yOffset + 1.0, 0);
        g.add(hanger);
      }
      break;
    }
    case 'overheadSign': {
      const panel = new THREE.Mesh(roundedBox(def.width, def.height, def.depth, 0.04, 2), material('MAT_Signage'));
      panel.position.y = def.yOffset;
      g.add(panel);
      const face = new THREE.Mesh(new THREE.PlaneGeometry(def.width * 0.9, def.height * 0.7), decal('DEC_Arrow'));
      face.position.set(0, def.yOffset, def.depth / 2 + 0.01);
      g.add(face);
      for (const side of [-1, 1]) {
        const chain = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 1.2, 5), material('MAT_Cable'));
        chain.position.set(side * (def.width / 2 - 0.16), def.yOffset + def.height / 2 + 0.6, 0);
        g.add(chain);
      }
      break;
    }
    case 'pipe': {
      const pipe = new THREE.Mesh(new THREE.CylinderGeometry(def.height / 2, def.height / 2, def.width, 12), material('MAT_RustedMetal'));
      pipe.rotation.z = Math.PI / 2;
      pipe.position.y = def.yOffset;
      g.add(pipe);
      for (const side of [-1, 1]) {
        const flange = new THREE.Mesh(new THREE.CylinderGeometry(def.height / 2 + 0.05, def.height / 2 + 0.05, 0.08, 12), material('MAT_PaintedMetalDark'));
        flange.rotation.z = Math.PI / 2;
        flange.position.set(side * def.width * 0.36, def.yOffset, 0);
        g.add(flange);
        const support = new THREE.Mesh(new THREE.BoxGeometry(0.08, 1.5, 0.08), material('MAT_PaintedMetalDark'));
        support.position.set(side * (def.width / 2 - 0.06), def.yOffset + 0.9, 0);
        g.add(support);
      }
      break;
    }
    case 'lowCeiling': {
      const slab = new THREE.Mesh(place(new THREE.BoxGeometry(def.width, def.height, def.depth), [0, def.yOffset, 0]), material('MAT_ConcreteRib'));
      g.add(slab);
      const lip = new THREE.Mesh(place(new THREE.BoxGeometry(def.width + 0.1, 0.16, 0.2), [0, def.yOffset - def.height / 2 + 0.08, -def.depth / 2]), material('MAT_HazardStripe'));
      g.add(lip);
      break;
    }
    case 'cableRig': {
      const tray = new THREE.Mesh(place(new THREE.BoxGeometry(def.width, 0.12, def.depth), [0, def.yOffset + 0.18, 0]), material('MAT_PaintedMetalDark'));
      g.add(tray);
      for (let i = 0; i < 4; i++) {
        const cable = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, def.width, 6), material('MAT_Cable'));
        cable.rotation.z = Math.PI / 2;
        cable.position.set(0, def.yOffset - 0.02 - (i % 2) * 0.1, -0.18 + i * 0.12);
        g.add(cable);
      }
      break;
    }
    case 'banner': {
      const cloth = new THREE.Mesh(new THREE.PlaneGeometry(def.width, def.height, 6, 2), material('MAT_Billboard'));
      // Ripple the cloth so it does not read as a flat card.
      const pos = cloth.geometry.getAttribute('position');
      for (let i = 0; i < pos.count; i++) pos.setZ(i, Math.sin(pos.getX(i) * 3) * 0.06);
      pos.needsUpdate = true;
      cloth.geometry.computeVertexNormals();
      cloth.position.y = def.yOffset;
      g.add(cloth);
      const rod = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, def.width + 0.2, 6), material('MAT_StainlessSteel'));
      rod.rotation.z = Math.PI / 2;
      rod.position.y = def.yOffset + def.height / 2;
      g.add(rod);
      break;
    }
    case 'scaffoldBeam': {
      const mat = material('MAT_StainlessSteel');
      const main = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, def.width, 7), mat);
      main.rotation.z = Math.PI / 2;
      main.position.y = def.yOffset;
      g.add(main);
      const deck = new THREE.Mesh(place(new THREE.BoxGeometry(def.width, 0.08, def.depth * 0.7), [0, def.yOffset + 0.2, 0]), material('MAT_WoodWorn'));
      g.add(deck);
      for (const side of [-1, 1]) {
        const upright = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.055, 3.4, 7), mat);
        upright.position.set(side * (def.width / 2 - 0.05), 1.7, 0);
        g.add(upright);
        const diagonal = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 2.0, 6), mat);
        diagonal.position.set(side * (def.width / 2 - 0.05), def.yOffset + 0.7, 0);
        diagonal.rotation.x = side * 0.6;
        g.add(diagonal);
      }
      break;
    }

    case 'tallBarrier': {
      const frame = new THREE.Mesh(place(new THREE.BoxGeometry(def.width, def.height, def.depth), [0, def.yOffset, 0]), material('MAT_Corrugated'));
      g.add(frame);
      const stripe = new THREE.Mesh(new THREE.PlaneGeometry(def.width, 0.5), decal('DEC_WarningStripes'));
      stripe.position.set(0, 0.6, def.depth / 2 + 0.01);
      g.add(stripe);
      const graffiti = new THREE.Mesh(new THREE.PlaneGeometry(def.width * 0.8, 1.2), decal('DEC_Graffiti'));
      graffiti.position.set(0, 1.7, def.depth / 2 + 0.01);
      g.add(graffiti);
      break;
    }
    case 'container': {
      const body = new THREE.Mesh(roundedBox(def.width, def.height, def.depth, 0.05, 2), material('MAT_Corrugated'));
      body.position.y = def.yOffset;
      g.add(body);
      // Corner castings and door furniture.
      for (const x of [-1, 1]) {
        for (const z of [-1, 1]) {
          for (const y of [0.1, def.height - 0.1]) {
            const casting = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.2, 0.24), material('MAT_PaintedMetalDark'));
            casting.position.set(x * (def.width / 2 - 0.12), y, z * (def.depth / 2 - 0.12));
            g.add(casting);
          }
        }
      }
      for (const x of [-0.5, 0.5]) {
        const bar = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, def.height * 0.85, 6), material('MAT_RustedMetal'));
        bar.position.set(x, def.yOffset, def.depth / 2 + 0.03);
        g.add(bar);
      }
      const rust = new THREE.Mesh(new THREE.PlaneGeometry(def.width * 0.9, def.height * 0.8), decal('DEC_Rust'));
      rust.position.set(0, def.yOffset, def.depth / 2 + 0.05);
      g.add(rust);
      break;
    }
    case 'fencePanel': {
      const frame = new THREE.Mesh(place(new THREE.BoxGeometry(def.width, def.height, 0.06), [0, def.yOffset, 0]), material('MAT_StainlessSteel'));
      frame.material.transparent = true;
      g.add(frame);
      const wireGeo = new THREE.BoxGeometry(0.02, def.height, 0.02);
      const wires = new THREE.InstancedMesh(wireGeo, material('MAT_StainlessSteel'), 14);
      const m = new THREE.Matrix4();
      for (let i = 0; i < 14; i++) {
        m.makeTranslation(-def.width / 2 + (i + 0.5) * (def.width / 14), def.yOffset, 0);
        wires.setMatrixAt(i, m);
      }
      wires.instanceMatrix.needsUpdate = true;
      g.add(wires);
      for (const side of [-1, 1]) {
        const post = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, def.height + 0.2, 8), material('MAT_PaintedMetalDark'));
        post.position.set(side * def.width / 2, def.yOffset, 0);
        g.add(post);
      }
      break;
    }
    case 'signalBox': {
      const body = new THREE.Mesh(roundedBox(def.width, def.height * 0.85, def.depth, 0.06, 2), material('MAT_PaintedMetal'));
      body.position.y = def.height * 0.425;
      g.add(body);
      const roof = new THREE.Mesh(place(new THREE.BoxGeometry(def.width + 0.2, 0.12, def.depth + 0.2), [0, def.height * 0.9, 0]), material('MAT_Corrugated'));
      g.add(roof);
      const door = new THREE.Mesh(new THREE.BoxGeometry(0.8, 1.9, 0.06), material('MAT_PaintedMetalDark'));
      door.position.set(0, 0.95, def.depth / 2 + 0.02);
      g.add(door);
      const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.1, 8, 6), material('MAT_NeonAmber'));
      lamp.position.set(0, 2.1, def.depth / 2 + 0.06);
      g.add(lamp);
      break;
    }
    case 'wall': {
      const body = new THREE.Mesh(place(new THREE.BoxGeometry(def.width, def.height, def.depth), [0, def.yOffset, 0]), material('MAT_ConcreteDirty'));
      g.add(body);
      const cap = new THREE.Mesh(place(new THREE.BoxGeometry(def.width + 0.12, 0.14, def.depth + 0.14), [0, def.height, 0]), material('MAT_Concrete'));
      g.add(cap);
      const tag = new THREE.Mesh(new THREE.PlaneGeometry(def.width * 0.85, 1.4), decal('DEC_Graffiti'));
      tag.position.set(0, def.height * 0.5, def.depth / 2 + 0.01);
      g.add(tag);
      break;
    }

    case 'ramp': {
      // A wedge with a checker-plate deck: the shape reads as "run up this".
      const shape = new THREE.Shape();
      shape.moveTo(-def.depth / 2, 0);
      shape.lineTo(def.depth / 2, 0);
      shape.lineTo(def.depth / 2, def.height);
      shape.lineTo(def.depth / 2 - 0.35, def.height);
      shape.closePath();
      const geo = new THREE.ExtrudeGeometry(shape, { depth: def.width, bevelEnabled: false });
      geo.translate(0, 0, -def.width / 2);
      geo.rotateY(Math.PI / 2);
      const body = new THREE.Mesh(geo, material('MAT_PaintedMetalDark'));
      g.add(body);
      const deck = new THREE.Mesh(
        place(new THREE.BoxGeometry(def.width, 0.06, def.depth * 1.02), [0, def.height * 0.5, 0]),
        material('MAT_HazardStripe'),
      );
      deck.rotation.x = Math.atan2(def.height, def.depth);
      g.add(deck);
      const lip = new THREE.Mesh(
        place(new THREE.BoxGeometry(def.width + 0.08, 0.1, 0.3), [0, def.height, def.depth / 2 - 0.15]),
        material('MAT_SafetyYellow'),
      );
      g.add(lip);
      break;
    }
    case 'train': {
      const variants: TrainVariant[] = ['TRN_Metro_A', 'TRN_Metro_B', 'TRN_Metro_C', 'TRN_Express_A', 'TRN_Freight_A', 'TRN_Service_A'];
      const variant = variants[Math.floor(hash01(seed) * variants.length) % variants.length];
      const train = buildTrain(variant, hash01(seed * 3) > 0.5 ? 'lead' : 'middle');
      g.add(train.object);
      g.userData.train = train;
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
  // Trains keep their own hierarchy: their doors animate, so they must not
  // be baked into a single mesh.
  if (def.mesh === 'train') return g;
  return mergeByMaterial(g) as THREE.Group;
}

export function obstacleDef(id: string): ObstacleDef {
  const def = OBSTACLE_BY_ID[id];
  if (!def) throw new Error(`Unknown obstacle id: ${id}`);
  return def;
}
