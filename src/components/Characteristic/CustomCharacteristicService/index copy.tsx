/*
 * Copyright (c) 2023, Texas Instruments Incorporated
 * All rights reserved.
 *
 * Redistribution and use in source and binary forms, with or without
 * modification, are permitted provided that the following conditions
 * are met:
 *
 * *  Redistributions of source code must retain the above copyright
 *    notice, this list of conditions and the following disclaimer.
 *
 * *  Redistributions in binary form must reproduce the above copyright
 *    notice, this list of conditions and the following disclaimer in the
 *    documentation and/or other materials provided with the distribution.
 *
 * *  Neither the name of Texas Instruments Incorporated nor the names of
 *    its contributors may be used to endorse or promote products derived
 *    from this software without specific prior written permission.
 *
 * THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS"
 * AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO,
 * THE IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR
 * PURPOSE ARE DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT OWNER OR
 * CONTRIBUTORS BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL,
 * EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED TO,
 * PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR PROFITS;
 * OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY OF LIABILITY,
 * WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT (INCLUDING NEGLIGENCE OR
 * OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF THIS SOFTWARE,
 * EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
 */

import {
  View,
  NativeEventEmitter,
  NativeModules,
  NativeSyntheticEvent,
  Switch,
  TextInputSubmitEditingEventData,
  StyleSheet,
  InteractionManager,
  TextInput,
  Alert,
  PermissionsAndroid,
  Linking,
} from "react-native";
import { useFocusEffect } from "@react-navigation/native";
import { Text } from "../../Themed";
import React, {
  useCallback,
  useEffect,
  useState,
  useRef,
  Dispatch,
  SetStateAction,
  useMemo,
} from "react";
import Layout from "../../../constants/Layout";
import BleManager from "react-native-ble-manager";
import Colors from "../../../constants/Colors";
import { Input } from "@rneui/themed";
import { TouchableOpacity } from "../../Themed";
import { Buffer } from "buffer";
import { uuidToCharacteristicName } from "../../../hooks/uuidToName";
import ServiceResponse from "./ServiceResponse";
import * as encoding from "text-encoding";
import { encode as btoa, decode } from "base-64";
import { useCharacteristicContext } from "../../../context/CharacteristicContext";
import RNFS from "react-native-fs";
import moment, { Moment } from "moment";
// Chart imports
import { SvgChart, SVGRenderer } from "@wuba/react-native-echarts";
import * as echarts from "echarts/core";
import { LineChart } from "echarts/charts";
import {
  TitleComponent,
  TooltipComponent,
  GridComponent,
  ToolboxComponent,
  DataZoomComponent,
} from "echarts/components";
import { Dimensions } from "react-native";
import { activateKeepAwake, deactivateKeepAwake } from 'expo-keep-awake';

// Register extensions
echarts.use([
  TitleComponent,
  TooltipComponent,
  ToolboxComponent,
  GridComponent,
  DataZoomComponent,
  SVGRenderer,
  LineChart,
]);
const E_HEIGHT = 300;
const E_WIDTH = Dimensions.get("window").width;

// Initialize
function ChartComponent({ option }: { option: any }) {
  const chartRef = useRef<any>(null);

  useEffect(() => {
    let chart: any;
    if (chartRef.current) {
      chart = echarts.init(chartRef.current, "light", {
        renderer: "svg",
        width: E_WIDTH,
        height: E_HEIGHT,
      });
      chart.setOption(option);
    }
    return () => chart?.dispose();
  }, [option]);

  return <SvgChart ref={chartRef} />;
}

interface Props {
  peripheralId: string;
  serviceUuid: string;
  serviceName: string;
  char: BleManager.Characteristic;
  selectedFormat: string;
  setSelectedFormat: Dispatch<SetStateAction<string>>;
  setSelectedMode: Dispatch<SetStateAction<string>>;
  selectedMode: string;
}

type Response = {
  data: string;
  time: string;
};

type AutoResponse = {
  data: number;
  time: string;
};

type CustomResponse = {
  data: string;
  index: number;
  batteryLevel: number;
  readings: number[];
  averages: number[];
  time: string;
};

const CharacteristicService: React.FC<Props> = ({
  peripheralId,
  serviceUuid: serviceUuid,
  serviceName: serviceName,
  char,
  selectedFormat,
  setSelectedFormat,
  setSelectedMode,
  selectedMode,
}) => {


  useEffect(() => {
    // Activate keep awake when Auto mode is selected
    if (selectedMode === 'Auto') {
      console.log('Activating keep awake\n\n***************\n\n');
      activateKeepAwake();
    } else {
      // Deactivate keep awake when mode changes
      deactivateKeepAwake();
    }

    // Clean up to deactivate keep awake when the component unmounts
    return () => {
      deactivateKeepAwake();
    };
  }, [selectedMode]);

  const { characteristicData, loading } = useCharacteristicContext();

  let checkNotify = Object.values(char.properties).indexOf("Notify") > -1;
  let checkWrite = Object.values(char.properties).indexOf("Write") > -1;
  let checkWriteWithoutRsp =
    Object.values(char.properties).indexOf("WriteWithoutResponse") > -1;
  let checkRead = Object.values(char.properties).indexOf("Read") > -1;
console.log("checkRead:"+checkRead);

  let propertiesString = "";
  if (checkRead) {
    propertiesString += "Read ";
  }
  if (checkWrite) {
    propertiesString += "Write ";
  }
  if (checkWriteWithoutRsp) {
    propertiesString += "WriteNoRsp ";
  }
  if (checkNotify) {
    propertiesString += "Notify";
  }

  const [charName, setCharName] = useState<string>(() => {
    if (char.characteristic.length == 4) {
      return "0x" + char.characteristic.toUpperCase();
    } else {
      return char.characteristic;
    }
  });

  const [writeInput, setWriteInput] = useState<string>("");
  const [writeWithResponseSwitch, setWriteWithResponseSwitch] =
    useState<boolean>(false);

  const [notificationSwitch, setNotificationSwitch] = useState<boolean>(false);

  const BleManagerModule = NativeModules.BleManager;
  const bleManagerEmitter = new NativeEventEmitter(BleManagerModule);

  const [readResponse, setReadResponse] = useState<Response[]>([]);
  const [writeResponse, setWriteResponse] = useState<Response[]>([]);
  const [notifyResponse, setNotifyResponse] = useState<Response[]>([]);

  const writeTextInputRef = useRef({});

  let initialFocus = useRef<boolean>(true);

  // ************************* Auto Read Constants Start ************************* //
  const [minutes, setMinutes] = useState<number>(1);
  const [seconds, setSeconds] = useState<number>(1);
  const [numReadings, setNumReadings] = useState<number>(60);
  const [avgTime, setAvgTime] = useState<number>(0.05);
  const [isReading, setIsReading] = useState<boolean>(false);
  const [readingInterval, setReadingInterval] = useState<NodeJS.Timeout | null>(
    null
  );
  const [timeouts, setTimeouts] = useState<NodeJS.Timeout[]>([]);
  // const [startDate, setStartDate] = useState<Date | null>(null);
  // const [endDate, setEndDate] = useState<Date | null>(null);
  const [autoReadResponses, setAutoReadResponses] = useState<AutoResponse[]>(
    []
  );
  const [customReadResponses, setCustomReadResponses] = useState<CustomResponse[]>(
    []
  );
  const [arrayLength, setArrayLength] = useState<number>(0);
  const [horizontalTickCount, setHorizontalTickCount] = useState<number>(0);
  const [chartData, setChartData] = useState<
    { name: string; value: (string | number)[] }[]
  >([]);
  const [filteredChartData, setFilteredChartData] = useState<
    { name: string; value: (string | number)[] }[]
  >([]);

  const [initialTime, setInitialTime] = useState<Date | null>(null);
  const [nextTime, setNextTime] = useState<Date | null>(null);

  // ************************* Auto Read Constants End ************************* //

  // CUSTOM MODE STATES START //
  const [x1, setX1] = useState<number>(1);
  const [x2, setX2] = useState<number>(1);
  const [x3, setX3] = useState<number>(1);
  const [x4, setX4] = useState<number>(1);
  const [sensorData, setSensorData] = useState<
  { packetIndex: number; batteryLevel: number; readings: number[]; avgReading: number }[]
>([]);

  const handleInputChange = (text: string, setter: React.Dispatch<React.SetStateAction<number>>) => {
    if (text === "") {
      setter(0); // Default to 0 instead of null
    } else {
      const newValue = Number(text);
      if (!isNaN(newValue)) {
        setter(newValue);
      }
    }
  };

  const [collectedReadings, setCollectedReadings] = useState([]);
  const collectionRef = useRef<{ index: number; battery: number; readings: number[]; time: string; }[]>([]);
  const [isCollecting, setIsCollecting] = useState(false);


  // ************************* Start Folder Creation ************************** //

  const [downloadsFolder, setDownloadsFolder] = useState("");
  const [folderPath, setFolderPath] = useState<string>("");
  const [fileName, setFileName] = useState<string>("");
  const [folderCreated, setFolderCreated] = useState<boolean>(false);

  // Function to check folder permissions
  const checkFolderPermissions = async () => {
    try {
      const granted = await PermissionsAndroid.request(
        PermissionsAndroid.PERMISSIONS.WRITE_EXTERNAL_STORAGE,
        {
          title: "Storage Permission",
          message: "App needs access to your storage to create folders.",
          buttonPositive: "OK",
        }
      );
      if (granted === PermissionsAndroid.RESULTS.GRANTED) {
        console.log("Write permission granted");
      } else {
        console.log("Write permission denied");
      }
    } catch (error) {
      console.error("Error checking folder permissions:", error);
    }
  };

  // Function to create a directory
  const makeDirectory = async (folderPath: string) => {
    try {
      if (!folderPath) {
        console.log("Folder path is not set.");
        return;
      }
      checkFolderPermissions(); // Check folder permissions before creating the folder
      // Check if the folder doesn't exist before creating it
      const folderExists = await RNFS.exists(folderPath);
      console.log("Folder exists:", folderExists);
      if (!folderExists) {
        await RNFS.mkdir(folderPath);
        setFolderCreated(true); // Set the flag to true after folder creation
        console.log("Folder created successfully:", folderPath);
      } else {
        console.log("Folder already exists:", folderPath);
      }
    } catch (error) {
      console.log("!!!!!!!!!!!!!!!!!!! Error creating folder:", error);
    }
  };

  useEffect(() => {
    console.log("Setting up folder paths...");
    // Get user's file paths from react-native-fs
    setDownloadsFolder(RNFS.DownloadDirectoryPath);
  }, []);

  useEffect(() => {
    console.log("downloadsFolder: ", downloadsFolder);
    // Concatenate folder paths after setting all state variables
    if (downloadsFolder) {
      setFolderPath(downloadsFolder + "/BLEFiles");
    }
  }, [downloadsFolder]);

  useEffect(() => {
    // Execute this function on first mount if the folder hasn't been created yet
    console.log("In folderPath: ", folderPath);
    if (!folderCreated && folderPath) {
      makeDirectory(folderPath);
      console.log("folderPath: ", folderPath);
    } else {
      checkFolderPermissions();
    }
  }, [folderPath, folderCreated]);

  // ************************* End Folder Creation ************************** //

  console.log(char.properties);

  let charUuidString = char.characteristic;
  if (charUuidString.length === 4) {
    charUuidString = "0x" + charUuidString.toUpperCase();
  }

  let charNameSize = 20;
  /* is it a 64B UUID */
  if (char.characteristic.length == 36) {
    charNameSize = 15;
  }

  useFocusEffect(
    useCallback(() => {
      const task = InteractionManager.runAfterInteractions(() => {
        if (initialFocus.current) {
          console.log("initial focuse");
          initialFocus.current = false;
        } else {
          console.log("refocuse");
        }

        console.log("CharacteristicService: addListener");
        bleManagerEmitter.addListener(
          "BleManagerDidUpdateValueForCharacteristic",
          ({ value, peripheral, characteristic, service }) => {
            console.log("notification: ", value);
            let hexString = "";
            if (selectedFormat === "UTF-8") {
              hexString = Buffer.from(value).toString("utf8");
              console.log("notification: converted to UTF-8 ", hexString);
            } else if (selectedFormat === "Dec") {
              hexString = value;
              console.log("notification: converted to Dec ", hexString);
            } else {
              // must be hex
              hexString = Buffer.from(value).toString("hex");
              console.log("notification: converted to Hex ", hexString);
            }

            /* Check include string and not dirrect match to ork around issue 
               switching between SimplePeripheral and PersistantApp */
            if (
              characteristic
                .toLowerCase()
                .includes(char.characteristic.toLowerCase())
            ) {
              setNotifyResponse((prev) => [
                {
                  data: hexString,
                  date: new Date().toDateString(),
                  time: new Date().toTimeString().split(" ")[0],
                },
                ...prev.slice(0, 4),
              ]);
            }
          }
        );
      });

      return () => {
        task.cancel();
        console.log("CharacteristicService: removeAllListeners");
        bleManagerEmitter.removeAllListeners(
          "BleManagerDidUpdateValueForCharacteristic"
        );
        if (Object.values(char.properties).indexOf("Notify") > -1) {
          //Cleaning up notification
          BleManager.stopNotification(
            peripheralId,
            serviceUuid,
            char.characteristic
          );
        }
      };
    }, [, selectedFormat])
  );

  useEffect(() => {
    console.log("selectedFormat ", selectedFormat);
  }, [selectedFormat]);

  useEffect(() => {
    let checkIfCharacteristicNameAvailable = async () => {
      try {
        let check = uuidToCharacteristicName(
          char.characteristic,
          characteristicData
        );
        if (check !== undefined) {
          setCharName(check);
        }
      } catch (error) {}
    };

    checkIfCharacteristicNameAvailable();

    return () => {
    };
  }, [notificationSwitch, selectedFormat]);

  useEffect(() => {
    if (Object.values(char.properties).indexOf("Notify") > -1) {
      if (notificationSwitch) {
        console.log("enabling notifications");
        // To enable BleManagerDidUpdateValueForCharacteristic listener
        BleManager.startNotification(
          peripheralId,
          serviceUuid,
          char.characteristic
        );
      } else {
        console.log("disabling notifications");
        BleManager.stopNotification(
          peripheralId,
          serviceUuid,
          char.characteristic
        );
      }
    } else {
      console.log("Notify not supported by this characteristic");
    }
  }, [notificationSwitch, selectedFormat]);

  const [writeBytes, setWriteBytes] = useState<Uint8Array | string>();

  const handleWrite = (hexString: string) => {
    if (hexString !== "") {
      setWriteBytes(hexString);

      setWriteWithResponseSwitch(true);
    } else {
      setWriteWithResponseSwitch(false);
    }
    setWriteInput(hexString);
  };

  const handleWriteSubmit = useCallback(
    (e: NativeSyntheticEvent<TextInputSubmitEditingEventData>) => {
      if (!checkWrite && checkWriteWithoutRsp) {
        console.log(
          "handleWriteSubmit: error write and writeWithoutRsp not supported"
        );
        return;
      }

      let writeFunction = checkWrite
        ? BleManager.write
        : BleManager.writeWithoutResponse;

      //let properteisString = writeWithResponseSwitch ? 'Write' : 'WriteWithoutResponse';

      let hexString = e.nativeEvent.text;

      let writeByteArray = Uint8Array.from([]);

      console.log("handleWriteSubmit: selectedFormat " + selectedFormat);

      if (selectedFormat === "UTF-8") {
        console.log("handleWriteSubmit: converting to UTF-8");

        let utf8Encode = new encoding.TextEncoder();
        writeByteArray = utf8Encode.encode(hexString);
      } else if (selectedFormat === "Dec") {
        hexString = hexString.toLowerCase();
        // check input it Dec
        if (hexString.match(/^[0-9]+$/) === null) {
          alert("Value enterd is not Decimal format");
          return;
        }
        console.log("handleWriteSubmit: converting to Dec");
        writeByteArray = Uint8Array.from(
          //@ts-ignore
          hexString.match(/.{1,2}/g).map((byte) => parseInt(byte, 10))
        );
      } else {
        // must be hex
        hexString = hexString.toLowerCase();
        // check input it Hex
        if (hexString.match(/^[0-9a-f]+$/) === null) {
          alert("Value enterd is not Hex format");
          return;
        }
        writeByteArray = Uint8Array.from(
          //@ts-ignore
          hexString.match(/.{1,2}/g).map((byte) => parseInt(byte, 16))
        );
      }

      let writeBytes = Array.from(writeByteArray);

      console.log(
        "handleWriteSubmit[" + writeBytes.length + "]: " + writeBytes
      );

      writeFunction(
        peripheralId,
        serviceUuid,
        char.characteristic,
        writeBytes,
        writeBytes.length
      )
        .then(() => {
          // Success code
          console.log(
            "Writen: " + writeByteArray + " to " + char.characteristic
          );

          setWriteInput("");

          let hexString = "";
          if (selectedFormat === "UTF-8") {
            hexString = Buffer.from(writeByteArray).toString("utf8");
          } else if (selectedFormat === "Dec") {
            hexString = writeByteArray
              .map((byte) => parseInt(byte.toString(10)))
              .toString();
          } else {
            hexString = Buffer.from(writeByteArray).toString("hex");
          }

          setWriteResponse((prev) => [
            { data: hexString, time: new Date().toTimeString().split(" ")[0] },
            ...prev.slice(0, 4),
          ]);
        })
        .catch((error) => {
          // Failure code
          console.log("write error: ", error);
        });
    },
    [writeWithResponseSwitch, selectedFormat]
  );


  const handleWriteButton = useCallback(() => {
    writeTextInputRef[char.characteristic].focus();
  }, []);

  const handleNotificationSwitch = useCallback(async () => {
    setNotificationSwitch((prev) => !prev);
  }, [notificationSwitch]);

  // ******************************** Manual Read ******************************** //


//   function generateDummyData() {
//     // Create a buffer of 9 bytes
//     let buffer = Buffer.alloc(9);

//     // Generate random values within expected ranges
//     let packetIndex = Math.floor(Math.random() * 65536); // 16-bit (0 to 65535)
//     let batteryLevel = Math.floor(Math.random() * 101); // 8-bit (0 to 100%)

//     // Generate sensor readings with a smooth variation
//     let baseValue = 1000 + Math.floor(Math.random() * 500); // Center around 1000
//     let readingValue1 = baseValue + Math.floor(Math.random() * 50);
//     let readingValue2 = baseValue + Math.floor(Math.random() * 50);
//     let readingValue3 = baseValue + Math.floor(Math.random() * 50);
//     let readingValue4 = baseValue + Math.floor(Math.random() * 50);

//     // Write values into the buffer
//     buffer.writeUInt16BE(packetIndex, 0); // First 2 bytes
//     buffer.writeUInt8(batteryLevel, 2);   // 3rd byte

//     // Pack 12-bit values
//     buffer.writeUInt16BE((readingValue1 << 4) | (readingValue2 >> 8), 3);
//     buffer.writeUInt16BE(((readingValue2 & 0xFF) << 8) | (readingValue3 >> 4), 5);
//     buffer.writeUInt16BE(((readingValue3 & 0xF) << 12) | readingValue4, 7);

//     return buffer;
// }


function generateDummyData(packetCount: number = 5): number[][] {
  const dummyPackets: number[][] = [];

  for (let i = 0; i < packetCount; i++) {
    const packetIndex = i; // Simulating sequential packet index
    const batteryLevel = Math.floor(Math.random() * 100); // Simulated battery level (0-100)

    // Simulated 12-bit sensor readings (0-4095)
    const readings = Array.from({ length: 4 }, () => Math.floor(Math.random() * 4096));

    // Convert 12-bit readings into 9-byte format
    const packet = [
      (packetIndex >> 8) & 0xFF, // Higher byte of index
      packetIndex & 0xFF,        // Lower byte of index
      batteryLevel,              // Battery level
      (readings[0] >> 4) & 0xFF, // Reading 1 (upper part)
      ((readings[0] & 0xF) << 4) | ((readings[1] >> 8) & 0xF), // Reading 1 (lower) + Reading 2 (upper)
      readings[1] & 0xFF,        // Reading 2 (lower)
      (readings[2] >> 4) & 0xFF, // Reading 3 (upper part)
      ((readings[2] & 0xF) << 4) | ((readings[3] >> 8) & 0xF), // Reading 3 (lower) + Reading 4 (upper)
      readings[3] & 0xFF,        // Reading 4 (lower)
    ];

    dummyPackets.push(packet);
  }

  return dummyPackets;
}



  // const handleReadButton = useCallback(() => {
   

  //   if (Object.values(char.properties).indexOf("Read") > -1) {
  //     BleManager.read(peripheralId, serviceUuid, char.characteristic)
  //       .then((data) => {
  //         // Success code
  //         let hexString = "";

  //         if (selectedFormat == "UTF-8") {
  //           hexString = Buffer.from(data).toString("utf8");
  //           console.log("handleReadButton: converted to UTF-8 ", hexString);
  //         } else if (selectedFormat === "Dec") {
  //           hexString = data;
  //           console.log("handleReadButton: converted to Dec ", hexString);
  //         } else {
  //           // must be hex
  //           hexString = Buffer.from(data).toString("hex");
  //           console.log("handleReadButton: converted to Hex ", hexString);
  //         }

  //         console.log("readResponse.length: " + readResponse.length);
  //         if (selectedMode === "Custom") {
            
  //           // console.log("IN CUSTOM MODEEEEE", data);
  //           // let packet = generateDummyData();
  //           // //let buffer = Buffer.from(packet);
  //           // const packetIndex = (packet[0] << 8) | packet[1]; // 16-bit index
  //           // const batteryLevel = packet[2]; // 8-bit battery level
        
  //           // // Extract 12-bit readings
  //           // const readings = [
  //           //   ((packet[3] << 4) | (packet[4] >> 4)) & 0xFFF,
  //           //   (((packet[4] & 0xF) << 8) | packet[5]) & 0xFFF,
  //           //   ((packet[6] << 4) | (packet[7] >> 4)) & 0xFFF,
  //           //   (((packet[7] & 0xF) << 8) | packet[8]) & 0xFFF,
  //           // ];
        
  //           // // Compute transformed readings
  //           // const transformedReadings = readings.map((v) =>
  //           //   x1 * Math.pow(v, 3) + x2 * Math.pow(v, 2) + x3 * v + x4
  //           // );
        
  //           // // Compute average of transformed readings
  //           // const avgReading =
  //           //   transformedReadings.reduce((sum, val) => sum + val, 0) / transformedReadings.length;

  //           // // Store data for plotting
  //           // setCustomReadResponses((prev) => [
  //           //   ...prev,
  //           //   {
  //           //     data: packet.toString('hex'), // Store as hex string
  //           //     index: packetIndex,
  //           //     batteryLevel: batteryLevel,
  //           //     readings: readings,
  //           //     averages: transformedReadings,
  //           //     averageReading: avgReading,
  //           //     time: new Date().toISOString(), // Include full date and time
  //           //   },
  //           // ]);

  //           let packet = generateDummyData();
  //           const packetIndex = (packet[0] << 8) | packet[1]; // 16-bit index
  //   const batteryLevel = packet[2]; // 8-bit battery level

  //   // Extract 12-bit readings
  //   const readings = [
  //     ((packet[3] << 4) | (packet[4] >> 4)) & 0xFFF,
  //     (((packet[4] & 0xF) << 8) | packet[5]) & 0xFFF,
  //     ((packet[6] << 4) | (packet[7] >> 4)) & 0xFFF,
  //     (((packet[7] & 0xF) << 8) | packet[8]) & 0xFFF,
  //   ];

  //   // Compute transformed readings
  //   const transformedReadings = readings.map((v) =>
  //     x1 * Math.pow(v, 3) + x2 * Math.pow(v, 2) + x3 * v + x4
  //   );

  //   // Compute average of transformed readings
  //   const avgReading =
  //     transformedReadings.reduce((sum, val) => sum + val, 0) / transformedReadings.length;

  //   // Store data in state (sorted by packet index)
  //   setSensorData((prevData) => {
  //     const updatedData = [...prevData, { packetIndex, batteryLevel, readings, avgReading }];
  //     return updatedData.sort((a, b) => a.packetIndex - b.packetIndex);
  //   });

  //         }
  //       })
  //       .catch((error) => {
  //         // Failure code
  //         console.log("read error: ", error);
  //       });
  //   } else {
  //     console.log("Read not supported by this characteristic");
  //   }
  // }, [selectedFormat, selectedMode, autoReadResponses]);


  const handleReadButton = useCallback(() => {
    if (!char?.properties || !("Read" in char.properties)) {
      console.log("Read not supported by this characteristic");
      return;
    }
  
    BleManager.read(peripheralId, serviceUuid, char.characteristic)
      .then((data) => {
        if (!data || data.length === 0) {
          console.log("Received empty data from BLE read");
          return;
        }
  
        let hexString;
        if (selectedFormat === "UTF-8") {
          hexString = Buffer.from(data).toString("utf8");
        } else if (selectedFormat === "Dec") {
          hexString = data.toString();
        } else {
          hexString = Buffer.from(data).toString("hex");
        }
  
        console.log(`handleReadButton: converted to ${selectedFormat} `, hexString);
  
        if (selectedMode === "Custom") {
          const dummyData = generateDummyData(5); // Simulate 5 packets
          const data = dummyData.flat();
          // Assuming multiple packets are received in `data`
          const packets = chunkArray(data, 9); // Assuming each packet is 9 bytes long
  
          const processedPackets = packets.map((packet) => {
            const packetIndex = (packet[0] << 8) | packet[1]; // 16-bit index
            const batteryLevel = packet[2]; // 8-bit battery level
  
            // Extract 12-bit readings
            const readings = [
              ((packet[3] << 4) | (packet[4] >> 4)) & 0xFFF,
              (((packet[4] & 0xF) << 8) | packet[5]) & 0xFFF,
              ((packet[6] << 4) | (packet[7] >> 4)) & 0xFFF,
              (((packet[7] & 0xF) << 8) | packet[8]) & 0xFFF,
            ];
  
            // Compute transformed readings
            const transformedReadings = readings.map((v) =>
              x1 * Math.pow(v, 3) + x2 * Math.pow(v, 2) + x3 * v + x4
            );
  
            // Compute average of transformed readings
            const avgReading =
              transformedReadings.reduce((sum, val) => sum + val, 0) / transformedReadings.length;
  
            return { packetIndex, batteryLevel, readings, avgReading };
          });
  
          // Store data in state (sorting & deduplication)
          setSensorData((prevData) => {
            const mergedData = [...prevData, ...processedPackets];
  
            // Remove duplicates by using a Set based on packetIndex
            const uniqueData = Array.from(new Map(mergedData.map((p) => [p.packetIndex, p])).values());
  
            return uniqueData.sort((a, b) => a.packetIndex - b.packetIndex);
          });
        }
      })
      .catch((error) => {
        console.log("read error: ", error);
      });
  }, [selectedFormat, selectedMode]);
  
  // Helper function to split data into packets of fixed size
  const chunkArray = (array: number[], size: number): number[][] => {
    const chunks: number[][] = [];
    for (let i = 0; i < array.length; i += size) {
      chunks.push(array.slice(i, i + size));
    }
    return chunks;
  };
  
  

 // Function to update chart data at 1.5 min intervals
 useEffect(() => {
  if (!sensorData || sensorData.length === 0) return; // Ensure sensorData exists

  const newChartData = sensorData.map((data, i) => ({
    time: new Date(Date.now() - (sensorData.length - 1 - i) * 90 * 1000), // Correct order
    avgReading: data.avgReading,
  }));

  setChartData(
    newChartData.map((item) => ({
      name: item.time.toISOString(), // Convert Date to string
      value: [item.avgReading], // Wrap avgReading in an array
    }))
  );
}, [sensorData]); // Run only when sensorData updates


  // ******************************** Custom Read ******************************** //

  // const handleCustomReading = () => {
  //   if (x1 === 0 || x2 === 0 || x3 === 0 || x4 === 0) {
  //     Alert.alert("Invalid Input", "Please enter valid input");
  //     return;
  //   }

  //   setIsReading(true);
  //   // Calculate the total time between sets in milliseconds
  //   // const intervalBetweenSets = 6 * 60 * 1000;
  //   const intervalBetweenSets = 0.5 * 60 * 1000;

  //   // Calculate the time between individual reads within each set in milliseconds
  //   // const intervalBetweenReads = 1.5 * 1000;
  //   const intervalBetweenReads = 0.25 * 1000;

  //   // Calculate the total number of readings to perform within each set
  //   const totalReadings = 4;

  //   // Initialize initialTime with the current time when the Read button is clicked
  //   const currentTime = new Date();
  //   setInitialTime(currentTime);
  //   // Initialize nextTime with the time after 5 minutes from initialTime
  //   const next = new Date(currentTime.getTime() + avgTime * 60 * 1000);
  //   setNextTime(next);
  //   console.log("Time now and next: ", currentTime, next);

  //   // Create a new file for the current set of readings
  //   const dateString = currentTime.toISOString().slice(0, 10); // Extract date in YYYY-MM-DD format
  //   const timeString = currentTime.toTimeString().slice(0, 8); // Extract time in HH:MM:SS format
  //   const fileName = sanitizeFilename(
  //     `${peripheralId}_${dateString}_${timeString}`
  //   );
  //   const deviceInfo = `${peripheralId},${serviceUuid},${serviceName}`;
  //   const headerRow = "Index,data,time,date,avg";
  //   const filePath = `${folderPath}/${fileName}.csv`;
  //   setFileName(fileName);
  //   console.log("File Path: ", filePath);
  //   // check if the directory exists, and create it if it doesn't
  //   RNFS.exists(folderPath)
  //     .then((exists) => {
  //       if (!exists) {
  //         RNFS.mkdir(folderPath, { NSURLIsExcludedFromBackupKey: true });
  //       }
  //     })
  //     .catch((error) => {
  //       console.error("Error checking directory:", error);
  //     });

  //   RNFS.writeFile(filePath, `${deviceInfo}\n${headerRow}\n`, "utf8")
  //     .then(() => {
  //       console.log("CSV file created successfully:", filePath);
  //     })
  //     .catch((error) => {
  //       console.error("Error creating CSV file:", error);
  //     });

  //   const performReadings = () => {
  //     console.log("Performing readings");
  //     // Loop to perform individual readings
  //     // for (let i = 0; i < totalReadings; i++) {
  //     //   const timeout = setTimeout(() => {
  //     //     // Perform the reading action here
  //     //     console.log(`Reading ${i + 1}`);
  //     //     handleReadButton();
  //     //     console.log("Readings performed");
  //     //   }, i * intervalBetweenReads);
  //     //   setTimeouts((prevTimeouts) => [...prevTimeouts, timeout]); // Store the timeout reference
  //     // }


  //     handleReadButton();
  //   };

  //   // Function to start the readings at the specified intervals
  //   const startReadingIntervals = () => {
  //     performReadings();

  //     return setInterval(() => {
  //       console.log("Starting next set of readings ");
  //       performReadings();
  //     }, intervalBetweenSets);
  //   };

  //   const interval = startReadingIntervals();
  //   setReadingInterval(interval);
  // };

  const handleCustomReading = () => {
    if (x1 === 0 || x2 === 0 || x3 === 0 || x4 === 0) {
      Alert.alert("Invalid Input", "Please enter valid input");
      return;
    }
  
    setIsReading(true);
  
    // Define the listening schedule
    // const intervalBetweenSets = 6 * 60 * 1000; // 6 minutes
    // const listenDuration = 10 * 1000; // 10 seconds
    // const readFrequency = 100; // Read every 100ms within the listen window

    // ⏳ **Reduced Interval & Duration for Faster Testing**
    const intervalBetweenSets = 2000; // ⏳ **Every 2 seconds instead of 6 minutes**
    const listenDuration = 5000; // ⏳ **Listen for 5 seconds instead of 10 seconds**
    const readFrequency = 100; // Read every 100ms
  
    // Set initial timestamps
    const currentTime = new Date();
    setInitialTime(currentTime);
  
    const next = new Date(currentTime.getTime() + avgTime * 60 * 1000);
    setNextTime(next);
    console.log("Time now and next: ", currentTime, next);
  
    // Prepare CSV file
    const dateString = currentTime.toISOString().slice(0, 10);
    const timeString = currentTime.toTimeString().slice(0, 8);
    const fileName = sanitizeFilename(`${peripheralId}_${dateString}_${timeString}`);
    const filePath = `${folderPath}/${fileName}.csv`;
    setFileName(fileName);
  
    RNFS.exists(folderPath).then((exists) => {
      if (!exists) {
        RNFS.mkdir(folderPath, { NSURLIsExcludedFromBackupKey: true });
      }
    });
  
    RNFS.writeFile(filePath, `${peripheralId},${serviceUuid},${serviceName}\nIndex,data,time,date,avg\n`, "utf8")
      .then(() => console.log("CSV file created:", filePath))
      .catch((error) => console.error("Error creating CSV file:", error));
  
    // Function to perform continuous readings for 10 seconds
    const performReadings = () => {
      console.log("⏳ Listening for 10 seconds...");
      const startTime = Date.now();
  
      const readLoop = setInterval(() => {
        if (Date.now() - startTime >= listenDuration) {
          clearInterval(readLoop);
          console.log("🛑 Stopping readings after 10 seconds.");
        } else {
          handleReadButton();
        }
      }, readFrequency);
  
      setTimeouts((prevTimeouts) => [...prevTimeouts, readLoop]); // Store timeout reference
    };
  
    // Schedule the first listening session exactly when 'nextTime' arrives
    // const firstReadDelay = next.getTime() - currentTime.getTime();
    const firstReadDelay = 2000; // ⏳ **Delay for 2 seconds instead of 5 minutes**
    console.log(`⏰ Scheduling first reading in ${firstReadDelay / 1000} seconds`);
  
    setTimeout(() => {
      performReadings();
      const interval = setInterval(() => {
        performReadings();
      }, intervalBetweenSets);
      setReadingInterval(interval);
    }, firstReadDelay);
  };
  

    // Calculate average and update chartData after every 5 minutes
    // useEffect(() => {
    //   const interval = setInterval(() => {
    //     if (initialTime && nextTime) {
    //       console.log(
    //         "Checking time passed ....................",
    //         initialTime,
    //         nextTime
    //       );
    //       // Check if 5 minutes have passed
    //       const currentTime = new Date();
    //       console.log(
    //         "Current Time:::::::::::: ",
    //         currentTime,
    //         currentTime >= nextTime
    //       );
    //       if (currentTime >= nextTime) {
    //         // if (true) {
    //         console.log("\n\n\n\n\n5 minutes have passed");
    //         console.log("customReadResponsescustomReadResponses: ", customReadResponses);
  
    //         // Extract timestamps and values from customReadResponses for plotting
    //         // const newChartData = customReadResponses.map((entry) => ({
    //         //   name: new Date(entry.time).toLocaleTimeString(), // X-axis: formatted time
    //         //   value: entry.averages, // Y-axis: array of computed averages
    //         // }));
  
    //         // // Append newChartData to existing chart data
    //         // setChartData((prev) => [...prev, ...newChartData]);
  
  
    //         const totalValues = customReadResponses.flatMap(response => response.averages); // Flatten all values
  
    //         const sum = totalValues.reduce((total, value) => total + value, 0); // Sum all values
            
    //         const average = totalValues.length > 0 ? sum / totalValues.length : 0; // Proper averaging
            
    //         console.log("\n\n\n\nAverage: ", average);
    //         console.log("Total values count: ", totalValues.length);
            
    //         setChartData((prevChartData) => [
    //           ...prevChartData,
    //           {
    //             name: nextTime.toISOString(),
    //             value: [nextTime.toISOString(), average], // Keep array format as expected
    //           },
    //         ]);
  
  
    //         // Save to CSV
    //        // appendCSVtoFile(folderPath, fileName, newChartData);
  
    //         // Reset the state for next interval
    //         setCustomReadResponses([]);
  
    //         // Update initialTime to nextTime
    //         setInitialTime(nextTime);
  
    //         // Set new nextTime (5 minutes ahead)
    //         // const newNextTime = new Date(nextTime.getTime() + avgTime * 60 * 1000);
    //         const newNextTime = new Date(nextTime.getTime() + 1 * 60 * 1000);
    //         setNextTime(newNextTime);
    //       }
    //     }
    //   }, 1000); // Check every second for the time passed
    //   return () => clearInterval(interval);
    // }, [initialTime, nextTime, customReadResponses]);

  // Filter the chartData based on the horizontalTickCount
  useEffect(() => {
    console.log(
      "chartData updated                 : ",
      chartData,
      chartData.length
    );

    if (
      horizontalTickCount === 1 ||
      horizontalTickCount === 6 ||
      horizontalTickCount === 24
    ) {
      const currentTime = new Date();
      const startTime = new Date(
        currentTime.getTime() - horizontalTickCount * 60 * 60 * 1000
      );

      console.log(
        "Filtering data: ",
        horizontalTickCount,
        startTime,
        currentTime
      );

      // Filter the chartData based on the startTime and currentTime
      const filteredChartData = chartData.filter(
        (response) =>
          new Date(response.name) >= startTime &&
          new Date(response.name) <= currentTime
      );

      // Check if the filtered chartData is different from the current chartData
      const isChartDataChanged =
        JSON.stringify(chartData) !== JSON.stringify(filteredChartData);

      if (isChartDataChanged) {
        // Update the chartData state with the filteredChartData
        setFilteredChartData(filteredChartData);
      }
    }
    else {
      console.log("HorizontalTick count is 0 ******************************")
      setFilteredChartData(chartData);

    }
  }, [chartData, horizontalTickCount]);

  // ************************************************ Stop and Save ************************************************
  const generateCSVContent = () => {
    // Generate data rows for each response
    const dataRows = autoReadResponses.map((response, index) => {
      const timeInString = new Date(response.time);
      const dateString = timeInString.toLocaleDateString(); // Extract date in MM/DD/YYYY format
      const timeString = timeInString.toTimeString().slice(0, 8); // Extract time in HH:MM:SS format
      return `${arrayLength + index + 1},${response.data},${timeString},${dateString}`;
    });

    const csvContent = [...dataRows].join("\n");
    console.log("CSV Content: ", csvContent);
    return csvContent;
  };

  const appendCSVtoFile = async (folderPath: string, fileName: string, average: number | null = null) => {
    try {
      // Check if the directory exists, and create it if it doesn't
      const directoryExists = await RNFS.exists(folderPath);
      console.log("Directory exists:", directoryExists);
      if (!directoryExists) {
        await RNFS.mkdir(folderPath, {
          NSURLIsExcludedFromBackupKey: true,
        }); // Create directory with option to exclude from backup
      }


      let csvContent = generateCSVContent();
      // Generate CSV content
      if (average !== null) {
        csvContent = csvContent + `,${average}`;
      }
      else {
        csvContent = csvContent;
      }

      // Append CSV content to file
      const filePath = `${folderPath}/${fileName}.csv`;
      console.log("File Path: ", filePath);
      //check if file exists
      const fileExists = await RNFS.exists(filePath);
      console.log("File exists:", fileExists);
      if (fileExists) {
        await RNFS.appendFile(filePath, csvContent + "\n", "utf8");
      } else {
        console.log("File does not exist! Couldn't append to file.");
      }

      console.log("CSV file appended successfully:", filePath);
    } catch (error) {
      console.error("Error appending to CSV file:", error);
    }
  };

  const sanitizeFilename = (filename: string) => {
    // Replace colons with periods to prevent issues with file names
    return filename.replace(/:/g, ".");
  };

  const handleStopReading = () => {
    console.log(
      "handleStopReading",
      autoReadResponses,
      autoReadResponses.length
    );

    // append the remaining data to the file
    appendCSVtoFile(folderPath, fileName);

    setIsReading(false);
    setAutoReadResponses([]);
    setChartData([]);
    setHorizontalTickCount(0);
    setArrayLength(0);
    // reset initial and next time
    setInitialTime(null);
    setNextTime(null);

    // Clear the timeouts
    timeouts.forEach((timeout) => clearTimeout(timeout));
    timeouts.length = 0;

    // Clear the interval
    if (readingInterval) {
      clearInterval(readingInterval);
      setReadingInterval(null);
    }
  };

  // ************************************************ End Stoppoing and saving file ************************************************

  const handleShowFiles = useCallback(() => {
    console.log("Handle Show Files");

    const message = `Your saved files are located in the following folder:\n\n${folderPath}\n\nPlease use a file manager app to navigate to this folder.`;

    Alert.alert(
      "File Location",
      message,
      [
        {
          text: "OK",
          onPress: () => console.log("OK Pressed"),
          style: "default",
        },
      ],
      { cancelable: false }
    );
  }, [folderPath]);

  // *********************************************** Graph Starts *********************************************** //

  // // Find the minimum value in your data array
  // let minData = Math.min(
  //   ...filteredChartData.map((dataPoint) => Number(dataPoint.value[1]))
  // );
  // let minYValue = minData - 20 > 0 ? Math.round(minData / 10) * 10 - 20 : 20; // Round down to the nearest 10

  // // Calculate the maximum value to ensure that the interval between each label is 10
  // let maxData = Math.max(
  //   ...filteredChartData.map((dataPoint) => Number(dataPoint.value[1]))
  // );
  // let maxYValue = Math.round(maxData / 10) * 10 + 10;

  // // if (maxYValue - minYValue < 50) {
  // //   maxYValue = minYValue + 100;
  // // }

  // const range = maxYValue - minYValue;
  // const yAxisInterval = range > 50 ? Math.ceil(range / 10) : 5;

  // console.log(
  //   "Chart Data min and max: ",
  //   minYValue,
  //   maxYValue,
  //   (maxYValue - minYValue) / 10
  // );
  // // Create the chart options
  // const chartOptions = useMemo(
  //   () => ({
  //     backgroundColor: "#333",
  //     grid: {
  //       top: "10%",
  //       bottom: "20%",
  //       left: "2%",
  //       right: "5%",
  //       containLabel: true,
        
  //     },
  //     dataZoom: {
  //       start: 0,
  //       type: "slider",
  //     },
  //     xAxis: {
  //       type: "time",
  //       splitNumber: 3,
  //       splitLine: {
  //         show: true,
  //         lineStyle: {
  //           color: 'yellow', 
  //           opacity: 0.1,    
  //         }
  //       },
  //       axisLabel: {
  //         formatter: function (value: any, index: any, name: any) {
  //           if (chartData.length === 1) {
  //             const date = new Date(chartData[0].name);
  //             const hours = date.getHours().toString().padStart(2, "0");
  //             const minutes = date.getMinutes().toString().padStart(2, "0");
  //             // console.log("hours: ", hours, "minutes: ", minutes);
  //             if (horizontalTickCount === 6 || horizontalTickCount === 24)
  //               return `${hours}`;
  //             return `${hours}:${minutes}`;
  //           }
  //           const date = new Date(value);
  //           const hours = date.getHours().toString().padStart(2, "0");
  //           const minutes = date.getMinutes().toString().padStart(2, "0");
  //           const seconds = date.getSeconds().toString().padStart(2, "0");
  //           // console.log("hours: ", hours, "minutes: ", minutes);
  //           if (horizontalTickCount === 6 || horizontalTickCount === 24)
  //             return `${hours}`;
  //           return `${hours}:${minutes}`;
  //         },
  //         // showMinLabel: true,
  //         // showMaxLabel: true,
  //         margin: 11.5,
  //         hideOverlap: true,
  //       },
  //     },
  //     yAxis: {
  //       type: "value",
  //       min: minYValue,
  //       max: maxYValue,
  //       interval: yAxisInterval,
  //       axisLine: {
  //         show: true
  //       },
  //       splitLine: {
  //         show: true,
  //         lineStyle: {
  //           color: 'yellow', 
  //           opacity: 0.1,    
  //         }
  //       },
  //       splitNumber: 10,
  //     },
  //     series: [
  //       {
  //         data: filteredChartData,
  //         type: "line",
  //         symbolSize: 1,
  //         lineStyle: {
  //           color: "rgba(210, 25, 25, 1)",
  //         },
  //         itemStyle: {
  //           color: "rgba(125, 103, 103, 1)",
  //         },
  //       },
  //     ],
  //   }),
  //   [filteredChartData]
  // );

  // *********************************************** Graph Ends *********************************************** //

  return (
    <View>
      
      {(checkWrite || checkWriteWithoutRsp) && (
        <View style={{ ...Layout.separators }}>
          <View style={[styles.container]}>
            <View
              style={{
                flexDirection: "row",
                alignItems: "center",
                justifyContent: "flex-start",
                paddingBottom: 0,
              }}
            >
              <TouchableOpacity
                onPress={handleWriteButton}
                style={[styles.readWriteButton]}
              >
                <Text style={[{ fontWeight: "bold" }]}>Write</Text>
              </TouchableOpacity>
              <Input
                ref={(input) => {
                  writeTextInputRef[char.characteristic] = input;
                }}
                value={writeInput}
                containerStyle={{
                  display: "flex",
                  flexDirection: "row",
                  borderWidth: 0,
                  borderBottomWidth: 0,
                }}
                inputContainerStyle={{
                  borderWidth: 0,
                  borderBottomWidth: 0,
                }}
                inputStyle={[styles.inputStyles]}
                onChangeText={(text) => handleWrite(text)}
                onSubmitEditing={(e) => handleWriteSubmit(e)}
              />
            </View>
          </View>
          <View style={{ paddingLeft: 25, paddingBottom: 20 }}>
            <ServiceResponse responseArray={writeResponse} />
          </View>
        </View>
      )}
     
      


      {checkRead && selectedMode === "Custom" && (
        <View>
          <View style={{ ...Layout.separators }}>
          <View style={styles.inputContainer}>
          <Text style={styles.label}>X1 Value</Text>
          <View style={styles.inputWrapper}>
            <TextInput
              value={x1 === 0 ? "" : x1.toString()} // Show empty if 0, but keep value internally
              onChangeText={(text) => handleInputChange(text, setX1)}
              keyboardType="numeric"
              placeholder="Enter X1"
              style={[styles.input, isReading ? { borderColor: "#eeeeee" } : { borderColor: "black" }]}
              editable={!isReading}
            />
          </View>
        </View>

        <View style={styles.inputContainer}>
          <Text style={styles.label}>X2 Value</Text>
          <View style={styles.inputWrapper}>
            <TextInput
              value={x2 === 0 ? "" : x2.toString()}
              onChangeText={(text) => handleInputChange(text, setX2)}
              keyboardType="numeric"
              placeholder="Enter X2"
              style={[styles.input, isReading ? { borderColor: "#eeeeee" } : { borderColor: "black" }]}
              editable={!isReading}
            />
          </View>
        </View>

        <View style={styles.inputContainer}>
          <Text style={styles.label}>X3 Value</Text>
          <View style={styles.inputWrapper}>
            <TextInput
              value={x3 === 0 ? "" : x3.toString()}
              onChangeText={(text) => handleInputChange(text, setX3)}
              keyboardType="numeric"
              placeholder="Enter X3"
              style={[styles.input, isReading ? { borderColor: "#eeeeee" } : { borderColor: "black" }]}
              editable={!isReading}
            />
          </View>
        </View>

        <View style={styles.inputContainer}>
          <Text style={styles.label}>X4 Value</Text>
          <View style={styles.inputWrapper}>
            <TextInput
              value={x4 === 0 ? "" : x4.toString()}
              onChangeText={(text) => handleInputChange(text, setX4)}
              keyboardType="numeric"
              placeholder="Enter X4"
              style={[styles.input, isReading ? { borderColor: "#eeeeee" } : { borderColor: "black" }]}
              editable={!isReading}
            />
          </View>
        </View>

          </View>
          {/* Display the three buttons */}
          <View style={[styles.insideContainer]}>
              <TouchableOpacity
                onPress={handleCustomReading}
                disabled={isReading}
                style={[styles.StartButton]}
              >
                <Text
                  style={[
                    isReading ? { color: "gray" } : { fontWeight: "bold" },
                  ]}
                >
                  Read
                </Text>
              </TouchableOpacity>

              <TouchableOpacity
                onPress={handleStopReading}
                style={[styles.StartButton]}
                disabled={!isReading}
              >
                <Text
                  style={[
                    !isReading ? { color: "gray" } : { fontWeight: "bold" },
                  ]}
                >
                  Stop
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={handleShowFiles}
                style={[styles.StartButton]}
              >
                <Text style={[{ fontWeight: "bold" }]}>Show Files</Text>
              </TouchableOpacity>
            </View>

            <View>
                <ChartComponent option={chartOptions} />
            </View>
        </View>
      )}


      {checkNotify && (
        <View>
          <View style={[styles.container]}>
            <View>
              <View
                style={{
                  alignContent: "center",
                  alignItems: "center",
                  flexDirection: "row",
                }}
              >
                <View style={{ flexDirection: "row" }}>
                  <Text
                    style={{
                      fontWeight: "bold",
                      paddingLeft: 12,
                      paddingRight: 20,
                    }}
                  >
                    Notifications
                  </Text>
                </View>
                <View
                  style={{
                    flexDirection: "row",
                    alignItems: "center",
                    paddingLeft: 80,
                    paddingRight: "auto",
                  }}
                >
                  <Text style={{ paddingRight: 10 }}>Enable</Text>
                  <Switch
                    value={notificationSwitch}
                    onChange={handleNotificationSwitch}
                  />
                </View>
              </View>
            </View>
          </View>
          <View style={{ paddingLeft: 25, paddingBottom: 20 }}>
            <ServiceResponse responseArray={notifyResponse} />
          </View>
        </View>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  charContainer: {
    paddingVertical: 15,
    paddingLeft: 20,
    marginHorizontal: 0,
    backgroundColor: Colors.lightGray,
  },
  container: {
    paddingTop: 10,
    marginLeft: 20,
    flexDirection: "row",
  },
  insideContainer: {
    flexDirection: "row",
    paddingHorizontal: 10,
    paddingVertical: 10,
    justifyContent: "center",
  },
  characteristicUUIDWrapper: {
    paddingVertical: 10,
    justifyContent: "center",
    alignItems: "center",
    borderWidth: 3,
  },
  inputStyles: {
    borderWidth: 0,
    borderBottomWidth: 0,
    borderColor: "black",
    paddingHorizontal: 10,
  },
  readWriteButton: {
    paddingVertical: 5,
    borderRadius: 5,
    alignItems: "center",
    paddingHorizontal: 10,
    backgroundColor: Colors.lightGray,
    borderWidth: 0,
    borderBottomWidth: 0,
  },
  writeWrapper: {
    flexDirection: "row",
    flex: 1,
    justifyContent: "space-between",
  },
  StartButton: {
    paddingVertical: 2,
    borderRadius: 5,
    alignItems: "center",
    paddingHorizontal: 10,
    backgroundColor: Colors.lightGray,
    borderWidth: 0,
    borderBottomWidth: 0,
    marginRight: "10%", // Add margin-right for spacing between buttons
    marginLeft: "5%", // Add margin-left for spacing between buttons
  },
  inputContainer: {
    flexDirection: "row",
    alignItems: "flex-start",
    marginTop: 2,
  },
  label: {
    marginRight: 10,
    marginLeft: 10,
    fontSize: 16,
    width: 150,
  },
  inputWrapper: {
    flex: 1,
  },
  input: {
    flex: 1,
    alignSelf: "stretch",
    borderWidth: 1,
    width: 100,
    marginLeft: "30%",
    marginRight: "10%",
    borderColor: "black",
    borderRadius: 5,
    fontSize: 16,
    textAlign: "center",
  },
  chartContainer: {
    flex: 1,
    width: "100%",
    marginTop: 20,
    borderWidth: 1,
    borderColor: "lightgray",
  },
});

export default CharacteristicService;
