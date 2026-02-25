import React from "react";
import { Navigate } from "react-router-dom";

/**
 * Legacy route kept for compatibility.
 * New onboarding flow is: SignUp → Welcome → FirstStoreSetup.
 */
export default function Onboarding() {
  return <Navigate to="/first-store" replace />;
}
