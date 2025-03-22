import { View } from 'react-native';
import React, { Dispatch, SetStateAction } from 'react';
import BleManager from 'react-native-ble-manager';
import CharacteristicService from '../CharacteristicService';
import CustomCharacteristicService from '../CustomCharacteristicService'; // Ensure this is imported

interface Props {
  characteristics: BleManager.Characteristic[];
  serviceUuid: string;
  serviceName: string;
  peripheralId: string;
  selectedFormat: string;
  setSelectedFormat: Dispatch<SetStateAction<string>>;
  setSelectedMode: Dispatch<SetStateAction<string>>;
  selectedMode: string;
}

const CharacteristicsList: React.FC<Props> = ({ 
  characteristics, 
  serviceUuid, 
  serviceName, 
  peripheralId, 
  selectedFormat, 
  setSelectedFormat, 
  setSelectedMode, 
  selectedMode 
}) => {
  return (
    <View>
      {characteristics.map((char, i) =>
        selectedMode === 'Custom' ? (
          <CustomCharacteristicService
            serviceUuid={serviceUuid}
            serviceName={serviceName}
            peripheralId={peripheralId}
            key={`char-service-${i}-${char.characteristic}`}
            char={char}
            selectedFormat={selectedFormat}
            setSelectedFormat={setSelectedFormat}
            setSelectedMode={setSelectedMode}
            selectedMode={selectedMode}
          />
        ) : (
          <CharacteristicService
            serviceUuid={serviceUuid}
            serviceName={serviceName}
            peripheralId={peripheralId}
            key={`char-service-${i}-${char.characteristic}`}
            char={char}
            selectedFormat={selectedFormat}
            setSelectedFormat={setSelectedFormat}
            setSelectedMode={setSelectedMode}
            selectedMode={selectedMode}
          />
        )
      )}
    </View>
  );
};

export default CharacteristicsList;
