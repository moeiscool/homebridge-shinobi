> ⚠️ Recently this repository was transferred to Shinobi Systems (moeiscool). We do not have complete understanding of its operation and welcome anyone to join us in maintaining it. Please send us any Pull Requests and we will present it to the community for additional review. If the overall consensus is positive (with test results) we will merge those changes.
> Join our Discord to discuss with the community! https://shinobi.community/

This document was revised by Shamim Shihab Akhtar, Developer at Shinobi Systems

# Homebridge-Shinobi Plugin Documentation

## Overview
Homebridge-Shinobi is a plugin designed to integrate Shinobi security cameras with HomeKit-compatible systems through Homebridge. Homebridge itself is a lightweight Node.js-based server that allows non-HomeKit devices to be compatible with Apple's Home app by emulating the HomeKit API.

With this plugin, users can seamlessly integrate their Shinobi cameras into the Apple HomeKit ecosystem. This enables them to view live camera feeds and receive motion detection alerts directly within the Apple Home app, enhancing the functionality of their security system within the HomeKit environment.

## Features
### 1. Fetching and Managing Cameras
- The plugin communicates with the Shinobi API to fetch camera data and either registers new cameras or restores cached ones during Homebridge restarts.
- The plugin sets up each camera accessory by fetching essential details like the manufacturer, model, and serial number. The camera name is set to the monitor ID, identifying the motion sensor in HomeKit.
- Each camera is assigned a unique identifier (UUID) to track its registration status in HomeKit.

### 2. Motion Detection
- The plugin handles motion detection by adding a motion sensor service to the Shinobi camera.
- Whenever motion is detected by a Shinobi camera, the plugin notifies HomeKit, allowing users to receive alerts.
- The motion detection state is automatically reset after a brief delay to ensure timely updates without lingering detections.

### 3. Video Streaming with FFmpeg
- The plugin configures and manages real-time video streaming from Shinobi cameras to work seamlessly within HomeKit using FFmpeg.
- The video feed is streamed with H.264 for video compression and encrypted using SRTP (Secure Real-Time Transport Protocol) to ensure secure transmission.
- The resolution, frame rate, and bitrate are dynamically adjusted based on HomeKit’s requirements to ensure optimal performance.
- FFmpeg is utilized to handle the real-time streaming of video from the Shinobi cameras, ensuring the video feed conforms to HomeKit's specifications.
- When Homebridge shuts down, the plugin ensures that streams are properly stopped, providing a smooth and reliable shutdown process without interruptions.

### 4. Snapshots
- The plugin fetches snapshots from Shinobi cameras via the API and delivers them to HomeKit when requested.

### 5. Stream Management
- It processes streaming requests from HomeKit, spawning FFmpeg for starting streams, terminating processes to stop streams, and reconfiguring if needed.

### 6. Substream Management
- It activates or deactivates low-resolution substreams from Shinobi cameras if available, enabling efficient streaming.
- Automatically toggles substream activation based on active streaming sessions.

## Instructions to Set Up and Run Homebridge with the Shinobi Plugin
To install, configure, and run Homebridge with the Shinobi plugin, follow the steps below to integrate Shinobi cameras into Apple's HomeKit using Homebridge.

### 1. Clone the Homebridge-Shinobi Plugin
Begin by cloning the plugin's repository from GitHub. In the terminal, enter the following command:
> git clone https://github.com/moeiscool/homebridge-shinobi.git

### 2. Install Plugin Dependencies
Navigate into the plugin's directory and install the required dependencies using npm:
> npm install

### 3. Ensure FFmpeg is Installed
Ensure that `ffmpeg` is installed and accessible in the system's PATH. If it is not, install it using the method appropriate for the operating system.
> For macOS, install it via Homebrew with the command: `brew install ffmpeg`  
> For Windows, download and install `ffmpeg` from [ffmpeg.org](https://ffmpeg.org).

### 4. Install Homebridge
Install Homebridge globally using npm:
> npm install -g homebridge

### 5. Install the Homebridge-Shinobi Plugin
Install the Homebridge-Shinobi plugin globally using npm:
> npm install -g homebridge-shinobi

### 6. Update the Configuration File
Update the configuration file (`config.json`) with the correct settings for the Shinobi plugin. Below is an example configuration:

```
{
  "platforms": [
    {
      "platform": "Shinobi",
      "shinobi_api": "http://your.shinobi.server",
      "api_key": "your_api_key_here",
      "group_key": "your_group_key_here",
      "monitors": [
        {
          "monitor_id": "monitor_1_id",
          "use_substream": false
        },
        {
          "monitor_id": "monitor_2_id",
          "use_substream": true
        },
        {
          "monitor_id": "monitor_3_id",
          "use_substream": true
        }
      ],
      "web_hook_port": "your_webhook_port",
      "https_key_path": "/path/to/https/key.pem",
      "https_cert_path": "/path/to/https/cert.pem",
      "ffmpeg_input_args": "-fflags +genpts",
      "ffmpeg_process_args": "-vsync drop -vcodec copy -an"
    }
  ]
}

```

### 7. Link the Plugin for Local Development (Optional)
To link the plugin with Homebridge for local development and testing, use the following command:
> npm link

### 8. Build the Plugin
Build the plugin from its TypeScript source files. This command compiles the code into JavaScript:
> npm run build

### 9. Run Homebridge
Once everything is installed and built, start Homebridge:
> homebridge

## Shinobi Camera and Apple HomeKit Integration Overview
This setup relies on several key components that facilitate communication between Shinobi cameras and Apple HomeKit devices. Shinobi-managed cameras provide live video streaming and snapshots to the Shinobi Server, which centrally manages these camera feeds.

The Homebridge server, with the Shinobi-Homebridge plugin, acts as a bridge between the Shinobi system and Apple's HomeKit ecosystem, enabling seamless integration.

## Potential New Features for Future Development
1. **Snapshot Capture on Motion Detection:** Automatically capture and deliver a snapshot to HomeKit whenever motion is detected.
2. **Access to Recorded Video:** Integrate access to recorded videos stored in Shinobi’s system directly through the Home app.
3. **Scheduling Motion Detection Notifications:** Allow scheduling of motion detection notifications for specific times.
4. **Enhanced Shinobi Camera Status Information:** Retrieve and display more detailed camera status information in HomeKit.
5. **Motion Detection History and Timeline:** Provide a history of motion detection events within the Home app.

## Is the Plugin Code Good or Bad?
The plugin code is well-structured and effectively integrates Shinobi cameras into HomeKit through Homebridge. However, it could benefit from more comprehensive error handling and modularization of lengthy functions to enhance readability and maintainability.
