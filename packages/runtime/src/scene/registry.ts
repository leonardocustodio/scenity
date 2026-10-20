// SPDX-License-Identifier: Apache-2.0
/**
 * The presenter registry: an instance, not a global. The builder finds the presenter of a component type in it. A
 * runtime plugin adds its presenters with `register`.
 */
import type { Presenter } from "./types";

export class PresenterRegistry {
  readonly #byId = new Map<string, Presenter>();

  constructor(presenters: readonly Presenter[] = []) {
    for (const presenter of presenters) this.register(presenter);
  }

  /** Add a presenter. A second presenter for the same component is an error. */
  register(presenter: Presenter): this {
    if (this.#byId.has(presenter.id)) throw new Error(`the presenter "${presenter.id}" is registered already`);
    this.#byId.set(presenter.id, presenter);
    return this;
  }

  get(id: string): Presenter | undefined {
    return this.#byId.get(id);
  }

  has(id: string): boolean {
    return this.#byId.has(id);
  }

  /** The presenters in the order of registration. */
  list(): Presenter[] {
    return [...this.#byId.values()];
  }
}
