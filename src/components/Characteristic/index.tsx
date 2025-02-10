import { StyleSheet, View } from 'react-native';
import { Text } from '../Themed';
import BleManager from 'react-native-ble-manager';
import DropDownPicker from 'react-native-dropdown-picker';
import React, { useState, useEffect } from 'react';
import { KeyboardAwareScrollView } from 'react-native-keyboard-aware-scroll-view';
import GenericService from './GenericService';
import CharacteristicsList from './CharacteristicsList';
import { Icon } from '../../../types';
import { useCharacteristicContext } from '../../context/CharacteristicContext';
import CharacteristicServiceSkeleton from './CharacteristicService/CharacteristicServiceSkeleton';

interface Props {
  serviceCharacteristics: BleManager.Characteristic[];
  serviceUuid: string;
  serviceName: string;
  peripheralId: string;
  icon: Icon;
}

const Characteristic: React.FC<Props> = ({
  serviceCharacteristics,
  serviceUuid,
  serviceName,
  peripheralId,
  icon,
}) => {

  type Formats = {
    label: string;
    value: string,
  };

  let availableFormats: Formats[] = [
    {
      label: 'Hex',
      value: 'Hex',
    },
    {
      label: 'Dec',
      value: 'Dec',
    },
    {
      label: 'UTF-8',
      value: 'UTF-8',
    },
  ];

  type Modes = {
    label: string;
    value: string;
  };
  
  let availableModes: Modes[] = [
    {
      label: 'Auto',
      value: 'Auto',
    },
    {
      label: 'Manual',
      value: 'Manual',
    },
  ];
  

  const [formats, setformats] = useState<Formats[]>(availableFormats);
  const [openFormatDropdown, setOpenFormatDropdown] = useState<boolean>(false);
  const [openModeDropdown, setOpenModeDropdown] = useState<boolean>(false);
  const [selectedFormat, setSelectedFormat] = useState<string>("Dec");
  const [modes, setModes] = useState<Modes[]>(availableModes);
  const [selectedMode, setSelectedMode] = useState<string>("Manual");
  const { characteristicData, loading } = useCharacteristicContext();

  return (
    <View>
      <GenericService
        serviceName={serviceName}
        serviceUuid={serviceUuid}
        icon={icon}
        peripheralId={peripheralId}
      />
      <View style={styles.rowContainer}>
        {/* Format Dropdown */}
        <View style={[styles.formatContainer]}>
          <Text style={{ fontSize: 15, paddingRight: 10 }}>Format</Text>
          <DropDownPicker
            zIndex={100}
            containerStyle={[styles.dropDownPickerContainer]}
            placeholder="Hex"
            open={openFormatDropdown} 
            setOpen={setOpenFormatDropdown} 
            value={selectedFormat}
            setValue={setSelectedFormat}
            items={formats}
            setItems={setformats}
            style={{ minHeight: 40 }}
          />
        </View>
        {/* Mode Dropdown */}
        <View style={[styles.formatContainer]}>
          <Text style={{ fontSize: 15, paddingRight: 10 }}>Mode</Text>
          <DropDownPicker
            zIndex={100}
            containerStyle={[styles.dropDownPickerContainer]}
            placeholder="Auto"
            open={openModeDropdown} 
            setOpen={setOpenModeDropdown} 
            value={selectedMode}
            setValue={setSelectedMode}
            items={modes}
            setItems={setModes}
            style={{ minHeight: 40 }}
          />
        </View>
      </View>
      <KeyboardAwareScrollView
        extraScrollHeight={30}
        contentContainerStyle={{
          paddingBottom: 240
        }}
        style={[styles.container]}
      >
        {!loading && (
          <CharacteristicsList
            peripheralId={peripheralId}
            serviceUuid={serviceUuid}
            serviceName={serviceName}
            characteristics={serviceCharacteristics}
            selectedFormat={selectedFormat}
            setSelectedFormat={setSelectedFormat}
            setSelectedMode={setSelectedMode}
            selectedMode={selectedMode} 
          />
        )}
        {
          loading && (
            <CharacteristicServiceSkeleton />
          )
        }
      </KeyboardAwareScrollView>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {},
  rowContainer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 20,
  },
  formatContainer: {
    flex: 1,
    paddingRight: 10,
    alignItems: 'center',
    flexDirection: 'row',
  },
  dropDownPickerContainer: {
    flex: 1,
  }
});


export default Characteristic;
