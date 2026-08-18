/**
 * Vitest setup. Pollutes the environment when POSTBOI_TEST_POLLUTE=1 so the whole suite
 * runs a second time as if the machine belonged to somebody else — see `test_pollute.ts`.
 */
import { pollute_env } from "./pollute.js"

if (process.env.POSTBOI_TEST_POLLUTE === "1") pollute_env()
