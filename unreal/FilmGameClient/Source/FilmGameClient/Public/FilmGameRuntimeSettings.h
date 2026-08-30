#pragma once

#include "CoreMinimal.h"
#include "Engine/DeveloperSettings.h"
#include "FilmGameRuntimeSettings.generated.h"

UCLASS(Config=Game, DefaultConfig, meta=(DisplayName="FilmGame Runtime"))
class FILMGAMECLIENT_API UFilmGameRuntimeSettings : public UDeveloperSettings
{
    GENERATED_BODY()

public:
    UPROPERTY(Config, EditAnywhere, BlueprintReadOnly, Category="Network")
    FString RuntimeGatewayUrl;

    UPROPERTY(Config, EditAnywhere, BlueprintReadOnly, Category="Content")
    FString RuntimePackagePath;

    UPROPERTY(Config, EditAnywhere, BlueprintReadOnly, Category="Network", meta=(ClampMin="1.0", ClampMax="120.0"))
    float ReconnectWindowSeconds = 30.0f;

    UPROPERTY(Config, EditAnywhere, BlueprintReadOnly, Category="Playback")
    bool bPreloadNextScene = true;
};

