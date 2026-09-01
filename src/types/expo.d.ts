/**
 * The slice of `expo-notifications` and `expo-constants` that `src/library/push/native.ts`
 * uses, declared here so the library type-checks without installing Expo (and React
 * Native behind it). Not published: svelte-package emits `dist/push/native.d.ts` from the
 * module's own exported types, none of which name an Expo type, so an app resolves the
 * real packages it already has.
 */
declare module "expo-notifications" {
	export interface NotificationPermissionsStatus {
		status: "granted" | "denied" | "undetermined"
		granted: boolean
		canAskAgain: boolean
		ios?: { status: number }
	}
	export const IosAuthorizationStatus: {
		readonly NOT_DETERMINED: number
		readonly DENIED: number
		readonly AUTHORIZED: number
		readonly PROVISIONAL: number
		readonly EPHEMERAL: number
	}
	export const AndroidImportance: {
		readonly MIN: number
		readonly LOW: number
		readonly DEFAULT: number
		readonly HIGH: number
		readonly MAX: number
	}
	export interface DevicePushToken {
		type: "ios" | "android" | "web"
		data: string
	}
	export interface ExpoPushToken {
		type: "expo"
		data: string
	}
	export function getPermissionsAsync(): Promise<NotificationPermissionsStatus>
	export function requestPermissionsAsync(request?: unknown): Promise<NotificationPermissionsStatus>
	export function getExpoPushTokenAsync(options?: { projectId?: string }): Promise<ExpoPushToken>
	export function getDevicePushTokenAsync(): Promise<DevicePushToken>
	export function unregisterForNotificationsAsync(): Promise<void>
	export function setNotificationChannelAsync(
		id: string,
		channel: { name: string; importance?: number }
	): Promise<unknown>
	export function addPushTokenListener(listener: (token: DevicePushToken) => void): {
		remove(): void
	}
}

declare module "expo-constants" {
	const Constants: {
		expoConfig?: { extra?: { eas?: { projectId?: string } } } | null
		easConfig?: { projectId?: string } | null
		executionEnvironment?: "bare" | "standalone" | "storeClient"
		platform?: { ios?: unknown; android?: unknown; web?: unknown } | null
	}
	export default Constants
}
