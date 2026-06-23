/**
 * lib/delay.js
 * Helpers de espera con jitter y backoff exponencial.
 * Usado para respetar rate-limits y reintentos.
 */
(function (root) {
  "use strict";

  function randInt(min, max) {
    min = Math.ceil(min);
    max = Math.floor(max);
    return Math.floor(Math.random() * (max - min + 1)) + min;
  }

  function sleep(ms) {
    return new Promise(function (r) {
      setTimeout(r, ms);
    });
  }

  /**
   * Espera aleatoria entre min y max (ms). Devuelve la duracion real.
   */
  async function randomDelay(min, max) {
    const ms = randInt(min, max);
    await sleep(ms);
    return ms;
  }

  /**
   * Backoff exponencial con jitter.
   *  - base: ms iniciales
   *  - attempt: 0,1,2,...
   *  - cap: tope superior
   */
  function backoff(attempt, base, cap) {
    base = base || 5000;
    cap = cap || 60000;
    const exp = Math.min(cap, base * Math.pow(2, attempt));
    return randInt(Math.floor(exp * 0.7), Math.floor(exp * 1.0));
  }

  root.Delay = { sleep, randomDelay, backoff, randInt };
})(typeof self !== "undefined" ? self : globalThis);
