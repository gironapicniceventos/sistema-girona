import { Suspense } from "react";
import SigninWithPassword from "../SigninWithPassword";
import { StaffLoginReference } from "../StaffLoginReference";

export default function Signin() {
  return (
    <>
      <div>
        <Suspense fallback={null}>
          <SigninWithPassword />
        </Suspense>
        <StaffLoginReference />
      </div>
    </>
  );
}
