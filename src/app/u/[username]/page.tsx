import { ProfileView, generateMetadata } from "./profile-view";

export { generateMetadata };

export default function ProfilePage(props: Omit<Parameters<typeof ProfileView>[0], "v2">) {
  return ProfileView(props);
}
