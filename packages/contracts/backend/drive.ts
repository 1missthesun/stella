export type DriveFile = {
  path: string;
  name: string;
  sizeBytes: number;
  contentType: string;
  source: string;
  createdAt: number;
  updatedAt: number;
};

export type DriveFileRecord = {
  path: string;
  name: string;
  sizeBytes: number;
  contentType: string;
  updatedAt: number;
};

export type DriveFileUrl = {
  path: string;
  name: string;
  sizeBytes: number;
  contentType: string;
  url: string;
  expiresAt: number;
};

export type DeviceFileLocation = {
  sourcePath: string;
  deviceId: string;
  deviceName: string;
  drivePath: string | null;
  name: string;
  sizeBytes: number;
  contentType: string;
  updatedAt: number;
};

export type DeviceFileRecordInput = {
  sourcePath: string;
  drivePath?: string;
  sizeBytes: number;
  contentType?: string;
};

export type DriveCalls = {
  "drive.prepareUpload": {
    args: { path: string; sizeBytes: number; contentType?: string };
    result: { path: string; uploadId: string; uploadUrl: string; contentType: string };
  };
  "drive.finalizeUpload": {
    args: { path: string; uploadId: string; contentType?: string; source?: string };
    result: DriveFileRecord;
  };
  "drive.fileUrl": {
    args: { path: string };
    result: DriveFileUrl;
  };
  "drive.delete": {
    args: { path: string };
    result: { deleted: boolean };
  };
  "drive.list": {
    args: { prefix?: string; limit?: number };
    result: { files: DriveFile[] };
  };
  "drive.recordDeviceFiles": {
    args: { deviceId: string; deviceName?: string; files: DeviceFileRecordInput[] };
    result: { recorded: number };
  };
  "drive.locateDeviceFiles": {
    args: { paths: string[] };
    result: { files: DeviceFileLocation[] };
  };
};

export type DriveViews = {
  "drive.files": {
    args: { prefix?: string; limit?: number };
    result: DriveFile[];
  };
};
