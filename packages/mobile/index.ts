import { AppRegistry } from "react-native";
import "./src/lib/user-ask-notification-actions";
import "expo-router/entry";
import { CarPlayRootWrapper } from "./src/carplay/CarPlayBridge";

AppRegistry.setWrapperComponentProvider(() => CarPlayRootWrapper);
