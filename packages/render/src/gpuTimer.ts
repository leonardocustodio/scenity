// SPDX-License-Identifier: Apache-2.0
/**
 * The GPU time of each frame of the 3D scene. The WebGL 2 extension
 * EXT_disjoint_timer_query_webgl2 measures the GPU time of the commands between two marks. The core starts the
 * timer only when the host asks for it (the performance harness), because the queries add a little GPU work.
 *
 * A result is available some frames after its frame. The timer keeps a small queue of queries and reads each one
 * when the GPU has its result. A disjoint event (the GPU changed its clock, or other work took the GPU) makes the
 * open results unusable, so the timer deletes them.
 */

/** The constants of EXT_disjoint_timer_query_webgl2 that the timer uses. */
export interface TimerQueryExtension {
  readonly TIME_ELAPSED_EXT: number;
  readonly GPU_DISJOINT_EXT: number;
}

/** The part of a WebGL 2 context that the timer uses (a test can give a fake). */
export interface TimerContext {
  readonly QUERY_RESULT: number;
  readonly QUERY_RESULT_AVAILABLE: number;
  getExtension(name: string): unknown;
  getParameter(name: number): unknown;
  createQuery(): WebGLQuery | null;
  deleteQuery(query: WebGLQuery | null): void;
  beginQuery(target: number, query: WebGLQuery): void;
  endQuery(target: number): void;
  getQueryParameter(query: WebGLQuery, name: number): unknown;
}

/** The longest queue of open queries. A GPU that is this far behind gives no sample for a new frame. */
const MAX_OPEN = 8;

export class GpuTimer {
  private readonly open: WebGLQuery[] = [];
  private active: WebGLQuery | null = null;

  private constructor(
    private readonly gl: TimerContext,
    private readonly ext: TimerQueryExtension,
  ) {}

  /** A timer for a context, or null when the browser does not give the extension. */
  static create(gl: TimerContext): GpuTimer | null {
    const ext = gl.getExtension("EXT_disjoint_timer_query_webgl2") as TimerQueryExtension | null;
    return ext === null ? null : new GpuTimer(gl, ext);
  }

  /** Start the measurement of a frame. */
  begin(): void {
    if (this.active !== null || this.open.length >= MAX_OPEN) return;
    const query = this.gl.createQuery();
    if (query === null) return;
    this.gl.beginQuery(this.ext.TIME_ELAPSED_EXT, query);
    this.active = query;
  }

  /** End the measurement of the frame that `begin` started. */
  end(): void {
    if (this.active === null) return;
    this.gl.endQuery(this.ext.TIME_ELAPSED_EXT);
    this.open.push(this.active);
    this.active = null;
  }

  /** Read the finished queries in their order and give the GPU time of each one in ms to `sink`. */
  poll(sink: (ms: number) => void): void {
    if (this.gl.getParameter(this.ext.GPU_DISJOINT_EXT) === true) {
      this.clear();
      return;
    }
    while (this.open.length > 0) {
      const query = this.open[0];
      if (query === undefined || this.gl.getQueryParameter(query, this.gl.QUERY_RESULT_AVAILABLE) !== true) return;
      this.open.shift();
      const nanoseconds = this.gl.getQueryParameter(query, this.gl.QUERY_RESULT);
      this.gl.deleteQuery(query);
      if (typeof nanoseconds === "number") sink(nanoseconds / 1e6);
    }
  }

  /** Delete the open queries (a disjoint event, or the end of the scene). */
  clear(): void {
    for (const query of this.open) this.gl.deleteQuery(query);
    this.open.length = 0;
    if (this.active !== null) {
      this.gl.endQuery(this.ext.TIME_ELAPSED_EXT);
      this.gl.deleteQuery(this.active);
      this.active = null;
    }
  }
}
