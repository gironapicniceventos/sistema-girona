import { Suspense } from "react";
import SigninWithPassword from "../SigninWithPassword";

export default function Signin() {
  return (
    <>
      <div>
        <Suspense fallback={null}>
          <SigninWithPassword />
        </Suspense>
      </div>
    </>
  );
}
