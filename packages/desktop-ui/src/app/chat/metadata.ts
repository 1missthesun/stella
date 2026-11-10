import { CustomHouse } from "@/ui/nav-icons";
import type { AppMetadata } from "../_shared/app-metadata";

const metadata: AppMetadata = {
  id: "chat",
  label: "Home",
  icon: CustomHouse,
  route: "/chat",
  slot: "top",
  order: 10,
};

export default metadata;
