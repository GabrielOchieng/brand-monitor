import { SignUp } from "@clerk/nextjs";

export default function SignUpPage() {
  return (
    <div className="flex justify-center pt-12">
      <SignUp />
    </div>
  );
}
