"use strict";

/**
 * Runtime configuration for external backend services.
 * Vanilla ES module compatible (no bundler / import.meta.env / process.env).
 */
if (typeof window !== "undefined") {
  window.PLATEOD_CONFIG = Object.assign(
    {
      ML_API_BASE_URL: "https://plateod-ml-backend.onrender.com"
    },
    window.PLATEOD_CONFIG || {}
  );
}
