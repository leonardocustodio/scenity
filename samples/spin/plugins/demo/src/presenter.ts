// SPDX-License-Identifier: Apache-2.0
/**
 * The presenter of `demo.spin`: a hub ring around the entity, so a frame shows which entities turn.
 * The ring is a child of the entity object, so it turns with the entity. `hub: false` shows no ring.
 */
import { Mesh, MeshStandardMaterial, TorusGeometry, type Material } from "three";
import type { Presenter } from "@scenity/runtime";
import type { SpinValue } from "./component";

/** The ring: a flat torus in the XZ plane. */
function hubRing(): Mesh {
  const ring = new Mesh(
    new TorusGeometry(0.5, 0.03, 8, 48),
    new MeshStandardMaterial({ color: "#f2a33a", roughness: 0.4 }),
  );
  ring.name = "demo.spin.hub";
  ring.rotation.x = Math.PI / 2;
  return ring;
}

export const spinPresenter: Presenter<SpinValue, Mesh | null> = {
  id: "demo.spin",
  create: (value) => (value.hub === false ? null : hubRing()),
  // The object stays while the hub value gives the same object. Else the builder makes it again.
  update: (object, value) => (object === null) === (value.hub === false),
  dispose: (object) => {
    if (object === null) return;
    object.geometry.dispose();
    (object.material as Material).dispose();
  },
};
