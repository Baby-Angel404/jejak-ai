/**
 * Kalkulator backend. Matematika aslinya ada di shared/calc supaya simulasi lokal
 * di client memakai rumus yang sama persis. Modul ini adalah pintu masuk server.
 */
export {
  footprint, withRange, estimateTokens,
  whToKwh, kwhToLitres, litresToMl, RANGE,
} from '../../../shared/calc'
export type { Footprint } from '../../../shared/calc'
export type { Coefficients, Range } from '../../../shared/types'