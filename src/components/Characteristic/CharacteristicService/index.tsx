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
  console.log("CharacteristicService: peripheralId", peripheralId);
  console.log("CharacteristicService: serviceUuid", serviceUuid);
  console.log("CharacteristicService: char.properties", char.properties);

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
  const [avgTime, setAvgTime] = useState<number>(5);
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
      // console.log('remove all listeners');
      // bleManagerEmitter.removeAllListeners('BleManagerDidUpdateValueForCharacteristic');
      // if (Object.values(char.properties).indexOf('Notify') > -1) {
      //   //Cleaning up notification
      //   BleManager.stopNotification(peripheralId, serviceUuid, char.characteristic);
      // }
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

  const handleWriteWithResponseSwitch = useCallback(() => {
    setWriteWithResponseSwitch((prev) => !prev);
    console.log("handleWriteSwitch");
  }, []);

  const handleWriteButton = useCallback(() => {
    writeTextInputRef[char.characteristic].focus();
  }, []);

  const handleNotificationSwitch = useCallback(async () => {
    setNotificationSwitch((prev) => !prev);
  }, [notificationSwitch]);

  // ******************************** Manual Read ******************************** //
  const handleReadButton = useCallback(() => {
    console.log(
      "handleReadButton selectedFormat on mode selectedMode",
      selectedFormat,
      selectedMode,
      peripheralId,
      serviceUuid,
      serviceName
    );
    // Helper function to convert time to seconds
    function timeToSeconds(timeString: string) {
      const [hours, minutes, seconds] = timeString.split(":");
      return (
        parseInt(hours, 10) * 3600 +
        parseInt(minutes, 10) * 60 +
        parseInt(seconds, 10)
      );
    }
    if (Object.values(char.properties).indexOf("Read") > -1) {
      BleManager.read(peripheralId, serviceUuid, char.characteristic)
        .then((data) => {
          // Success code
          let hexString = "";

          if (selectedFormat == "UTF-8") {
            hexString = Buffer.from(data).toString("utf8");
            console.log("handleReadButton: converted to UTF-8 ", hexString);
          } else if (selectedFormat === "Dec") {
            hexString = data;
            console.log("handleReadButton: converted to Dec ", hexString);
          } else {
            // must be hex
            hexString = Buffer.from(data).toString("hex");
            console.log("handleReadButton: converted to Hex ", hexString);
          }

          console.log("readResponse.length: " + readResponse.length);
          if (selectedMode === "Manual") {
            console.log("Selected Mode", selectedMode);
            setReadResponse((prev) => [
              {
                data: hexString,
                time: new Date().toTimeString().split(" ")[0],
              },
              ...prev.slice(0, 4),
            ]);
            console.log("manual read response: ", data, readResponse);
          } else if (selectedMode === "Auto") {
            console.log("Selected Mode", selectedMode);
            setAutoReadResponses((prev) => [
              ...prev,
              {
                data: parseInt(hexString.join(""), 10),
                time: new Date().toISOString(), // Use toISOString() to include full date and time
              },
            ]);
          }
        })
        .catch((error) => {
          // Failure code
          console.log("read error: ", error);
        });
    } else {
      console.log("Read not supported by this characteristic");
    }
  }, [selectedFormat, selectedMode, autoReadResponses]);

  // ******************************** Auto Read ******************************** //

  const handleStartReading = () => {
    console.log(
      "Peripheral ID: ",
      peripheralId,
      serviceUuid,
      char.characteristic
    );

    if (autoReadResponses.length > 0) {
      setAutoReadResponses([]);
    }
    console.log("handleStartReading: ", minutes, seconds, numReadings);
    if (numReadings === 0 || minutes === 0 || seconds === 0) {
      console.log("handleStartReading: invalid input");
      Alert.alert(
        "Invalid Input",
        "Please enter valid input",
        [
          {
            text: "OK",
            onPress: () => console.log("OK Pressed"),
            style: "default",
          },
        ],
        { cancelable: false }
      );
      return;
    }
    if (minutes * 60 < numReadings * seconds) {
      console.log("handleStartReading: invalid input");
      Alert.alert(
        "Invalid Input",
        "Number of readings does not fit in the given time interval. Please decrease the number of readings or increase the time interval.",
        [
          {
            text: "OK",
            onPress: () => console.log("OK Pressed"),
            style: "default",
          },
        ],
        { cancelable: false }
      );
      return;
    }
    setIsReading(true);
    // Calculate the total time between sets in milliseconds
    const intervalBetweenSets = minutes * 60 * 1000;

    // Calculate the time between individual reads within each set in milliseconds
    const intervalBetweenReads = seconds * 1000;

    // Calculate the total number of readings to perform within each set
    const totalReadings = numReadings;

    // Initialize initialTime with the current time when the Read button is clicked
    const currentTime = new Date();
    setInitialTime(currentTime);
    // Initialize nextTime with the time after 5 minutes from initialTime
    const next = new Date(currentTime.getTime() + avgTime * 60 * 1000);
    setNextTime(next);
    console.log("Time now and next: ", currentTime, next);

    // Create a new file for the current set of readings
    const dateString = currentTime.toISOString().slice(0, 10); // Extract date in YYYY-MM-DD format
    const timeString = currentTime.toTimeString().slice(0, 8); // Extract time in HH:MM:SS format
    const fileName = sanitizeFilename(
      `${peripheralId}_${dateString}_${timeString}`
    );
    const deviceInfo = `${peripheralId},${serviceUuid},${serviceName}`;
    const headerRow = "Index,data,time,date,avg";
    const filePath = `${folderPath}/${fileName}.csv`;
    setFileName(fileName);
    console.log("File Path: ", filePath);
    // check if the directory exists, and create it if it doesn't
    RNFS.exists(folderPath)
      .then((exists) => {
        if (!exists) {
          RNFS.mkdir(folderPath, { NSURLIsExcludedFromBackupKey: true });
        }
      })
      .catch((error) => {
        console.error("Error checking directory:", error);
      });

    RNFS.writeFile(filePath, `${deviceInfo}\n${headerRow}\n`, "utf8")
      .then(() => {
        console.log("CSV file created successfully:", filePath);
      })
      .catch((error) => {
        console.error("Error creating CSV file:", error);
      });

    // Function to perform a single set of readings
    const performReadings = () => {
      console.log("Performing readings");
      // Loop to perform individual readings
      for (let i = 0; i < totalReadings; i++) {
        const timeout = setTimeout(() => {
          // Perform the reading action here
          console.log(`Reading ${i + 1}`);
          handleReadButton();
          console.log("Readings performed");
        }, i * intervalBetweenReads);
        setTimeouts((prevTimeouts) => [...prevTimeouts, timeout]); // Store the timeout reference
      }
    };

    // Function to start the readings at the specified intervals
    const startReadingIntervals = () => {
      performReadings();

      return setInterval(() => {
        console.log("Starting next set of readings ");
        performReadings();
      }, intervalBetweenSets + intervalBetweenReads);
    };

    const interval = startReadingIntervals();
    setReadingInterval(interval);
  };

  // Calculate average and update chartData after every 5 minutes
  useEffect(() => {
    const interval = setInterval(() => {
      if (initialTime && nextTime) {
        console.log(
          "Checking time passed ....................",
          initialTime,
          nextTime
        );
        // Check if 5 minutes have passed
        const currentTime = new Date();
        console.log(
          "Current Time:::::::::::: ",
          currentTime,
          currentTime >= nextTime
        );
        if (currentTime >= nextTime) {
          console.log("\n\n\n\n\n5 minutes have passed");
          // Calculate average of all elements in autoReadResponses
          const sum = autoReadResponses.reduce(
            (total, response) => total + response.data,
            0
          );
          const average =
            autoReadResponses.length > 0 ? sum / autoReadResponses.length : 0;

          console.log("\n\n\n\nAverage: ", average);
          console.log(
            "length of autoReadResponses: ",
            autoReadResponses.length
          );

          // Append average value to chartData with the time of nextTime
          setChartData((prevChartData) => [
            ...prevChartData,
            {
              name: nextTime.toISOString(),
              value: [nextTime.toISOString(), average],
            },
          ]);
          
          setArrayLength(autoReadResponses.length);
          // Append the current array to the file with the average value
          appendCSVtoFile(folderPath, fileName, average);
          // Empty the autoReadResponses array
          setAutoReadResponses([]);

          // Update initialTime to nextTime
          setInitialTime(nextTime);

          // Calculate the new value of nextTime by adding 5 minutes to the initialTime
          const newNextTime = new Date(
            nextTime.getTime() + avgTime * 60 * 1000
          );
          setNextTime(newNextTime);
        }
      }
    }, 1000); // Check every second for the time passed
    return () => clearInterval(interval);
  }, [initialTime, nextTime, autoReadResponses]);

  //  Use useEffect to log autoReadResponses whenever it changes
  useEffect(() => {
    console.log(
      "autoReadResponses updated                 : ",
      autoReadResponses,
      autoReadResponses.length
    );
  }, [autoReadResponses]);

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

  // Find the minimum value in your data array
  let minData = Math.min(
    ...filteredChartData.map((dataPoint) => Number(dataPoint.value[1]))
  );
  let minYValue = minData - 20 > 0 ? Math.round(minData / 10) * 10 - 20 : 20; // Round down to the nearest 10

  // Calculate the maximum value to ensure that the interval between each label is 10
  let maxData = Math.max(
    ...filteredChartData.map((dataPoint) => Number(dataPoint.value[1]))
  );
  let maxYValue = Math.round(maxData / 10) * 10 + 10;

  // if (maxYValue - minYValue < 50) {
  //   maxYValue = minYValue + 100;
  // }

  const range = maxYValue - minYValue;
  const yAxisInterval = range > 50 ? Math.ceil(range / 10) : 5;

  console.log(
    "Chart Data min and max: ",
    minYValue,
    maxYValue,
    (maxYValue - minYValue) / 10
  );
  // Create the chart options
  const chartOptions = useMemo(
    () => ({
      backgroundColor: "#333",
      grid: {
        top: "10%",
        bottom: "20%",
        left: "2%",
        right: "5%",
        containLabel: true,
        
      },
      dataZoom: {
        start: 0,
        type: "slider",
      },
      xAxis: {
        type: "time",
        splitNumber: 3,
        splitLine: {
          show: true,
          lineStyle: {
            color: 'yellow', 
            opacity: 0.1,    
          }
        },
        axisLabel: {
          formatter: function (value: any, index: any, name: any) {
            if (chartData.length === 1) {
              const date = new Date(chartData[0].name);
              const hours = date.getHours().toString().padStart(2, "0");
              const minutes = date.getMinutes().toString().padStart(2, "0");
              // console.log("hours: ", hours, "minutes: ", minutes);
              if (horizontalTickCount === 6 || horizontalTickCount === 24)
                return `${hours}`;
              return `${hours}:${minutes}`;
            }
            const date = new Date(value);
            const hours = date.getHours().toString().padStart(2, "0");
            const minutes = date.getMinutes().toString().padStart(2, "0");
            const seconds = date.getSeconds().toString().padStart(2, "0");
            // console.log("hours: ", hours, "minutes: ", minutes);
            if (horizontalTickCount === 6 || horizontalTickCount === 24)
              return `${hours}`;
            return `${hours}:${minutes}`;
          },
          // showMinLabel: true,
          // showMaxLabel: true,
          margin: 11.5,
          hideOverlap: true,
        },
      },
      yAxis: {
        type: "value",
        min: minYValue,
        max: maxYValue,
        interval: yAxisInterval,
        axisLine: {
          show: true
        },
        splitLine: {
          show: true,
          lineStyle: {
            color: 'yellow', 
            opacity: 0.1,    
          }
        },
        splitNumber: 10,
      },
      series: [
        {
          data: filteredChartData,
          type: "line",
          symbolSize: 1,
          lineStyle: {
            color: "rgba(210, 25, 25, 1)",
          },
          itemStyle: {
            color: "rgba(125, 103, 103, 1)",
          },
        },
      ],
    }),
    [filteredChartData]
  );

  // *********************************************** Graph Ends *********************************************** //

  return (
    <View>
      {!(selectedMode === "Auto") && (
        <View style={[styles.charContainer]}>
          <Text style={{ fontWeight: "bold", fontSize: charNameSize }}>
            {charName}
          </Text>
          <View
            style={[
              {
                alignItems: "flex-start",
                paddingTop: 10,
                paddingLeft: 10,
                flexDirection: "column",
              },
            ]}
          >
            {charName != charUuidString && (
              <Text style={[{}]}>UUID: {charUuidString}</Text>
            )}
            <Text style={[{ fontWeight: "200", paddingTop: 5 }]}>
              Properties: {propertiesString}
            </Text>
          </View>
        </View>
      )}
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
      {checkRead && selectedMode === "Manual" && (
        <View style={{ ...Layout.separators }}>
          <View style={[styles.container]}>
            <View>
              <View
                style={{
                  flexDirection: "row",
                  flex: 1,
                  paddingBottom: 10,
                }}
              >
                <TouchableOpacity
                  onPress={handleReadButton}
                  style={[styles.readWriteButton]}
                >
                  <Text style={[{ fontWeight: "bold" }]}>Read</Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>
          <View style={{ paddingLeft: 25, paddingBottom: 20 }}>
            <ServiceResponse responseArray={readResponse} />
          </View>
        </View>
      )}
      {checkRead && selectedMode === "Auto" && (
        <View>
          <View style={{ ...Layout.separators }}>
            {/* Display the three inputs */}
            <View style={styles.inputContainer}>
              <Text style={styles.label}>Sets Interval (Min) </Text>
              <View style={styles.inputWrapper}>
                <TextInput
                  value={minutes === 0 ? "" : minutes.toString()}
                  onChangeText={(text) => {
                    const newValue = parseInt(text);
                    if (!isNaN(newValue) || text === "0") {
                      setMinutes(newValue);
                    } else {
                      setMinutes(0);
                    }
                  }}
                  keyboardType="numeric"
                  placeholder={minutes === 0 ? "min" : ""}
                  style={[
                    styles.input,
                    isReading
                      ? { borderColor: "#eeeeee" }
                      : { borderColor: "black" },
                  ]}
                  editable={!isReading}
                />
              </View>
            </View>
            <View style={styles.inputContainer}>
              <Text style={styles.label}>Reads Interval (Sec)</Text>
              <View style={styles.inputWrapper}>
                <TextInput
                  value={seconds === 0 ? "" : seconds.toString()}
                  onChangeText={(text) => {
                    const newValue = parseInt(text);
                    if (!isNaN(newValue) || text === "0") {
                      setSeconds(newValue);
                    } else {
                      setSeconds(0);
                    }
                  }}
                  keyboardType="numeric"
                  placeholder={seconds === 0 ? "sec" : ""}
                  style={[
                    styles.input,
                    isReading
                      ? { borderColor: "#eeeeee" }
                      : { borderColor: "black" },
                  ]}
                  editable={!isReading}
                />
              </View>
            </View>
            <View style={styles.inputContainer}>
              <Text style={styles.label}>Reads per Set </Text>
              <View style={styles.inputWrapper}>
                <TextInput
                  value={numReadings === 0 ? "" : numReadings.toString()}
                  onChangeText={(text) => {
                    if (text === "") {
                      setNumReadings(0); // Set to 0 only when the input is empty
                    } else {
                      const newValue = parseInt(text);
                      if (!isNaN(newValue) || text === "0") {
                        setNumReadings(newValue);
                      }
                    }
                  }}
                  keyboardType="numeric"
                  placeholder={numReadings === 0 ? "int" : ""}
                  style={[
                    styles.input,
                    isReading
                      ? { borderColor: "#eeeeee" }
                      : { borderColor: "black" },
                  ]}
                  editable={!isReading}
                />
              </View>
            </View>
            <View style={styles.inputContainer}>
              <Text style={styles.label}>Graph avg time (Min) </Text>
              <View style={styles.inputWrapper}>
                <TextInput
                  value={avgTime === 0 ? "" : avgTime.toString()}
                  onChangeText={(text) => {
                    if (text === "") {
                      setAvgTime(0); // Set to 0 only when the input is empty
                    } else {
                      const newValue = parseInt(text);
                      if (!isNaN(newValue) || text === "0") {
                        setAvgTime(newValue);
                      }
                    }
                  }}
                  keyboardType="numeric"
                  placeholder={numReadings === 0 ? "int" : ""}
                  style={[
                    styles.input,
                    isReading
                      ? { borderColor: "#eeeeee" }
                      : { borderColor: "black" },
                  ]}
                  editable={!isReading}
                />
              </View>
            </View>

            {/* Display the three buttons */}
            <View style={[styles.insideContainer]}>
              <TouchableOpacity
                onPress={handleStartReading}
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
          </View>

          {/* Display the graph */}
          {isReading && (
            <View
              style={{
                paddingHorizontal: 5,
              }}
            >
              {/* Display the three options */}
              <View style={[styles.insideContainer]}>
                <TouchableOpacity
                  onPress={() => setHorizontalTickCount(0)}
                  style={[styles.StartButton]}
                  disabled={horizontalTickCount === 0}
                >
                  <Text style={[{ fontWeight: "bold" }, horizontalTickCount === 0 ? { color: "gray" } : { color: "black" }]}>Default</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={() => setHorizontalTickCount(1)}
                  style={[styles.StartButton]}
                  disabled={horizontalTickCount === 1}
                >
                  <Text style={[{ fontWeight: "bold" }, horizontalTickCount === 1 ? { color: "gray" } : { color: "black" }]}>1h</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={() => setHorizontalTickCount(6)}
                  style={[styles.StartButton]}
                  disabled={horizontalTickCount === 6}
                >
                  <Text style={[{ fontWeight: "bold" }, horizontalTickCount === 6 ? { color: "gray" } : { color: "black" }]}>6h</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={() => setHorizontalTickCount(24)}
                  style={[styles.StartButton]}
                  disabled={horizontalTickCount === 24}
                >
                  <Text style={[{ fontWeight: "bold" }, horizontalTickCount === 24 ? { color: "gray" } : { color: "black" }]}>24h</Text>
                </TouchableOpacity >
              </View>

              {/* Chart component */}
              <View>
                <ChartComponent option={chartOptions} />
              </View>
            </View>
          )}
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
