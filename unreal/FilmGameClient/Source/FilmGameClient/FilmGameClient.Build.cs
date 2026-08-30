using UnrealBuildTool;

public class FilmGameClient : ModuleRules
{
    public FilmGameClient(ReadOnlyTargetRules Target) : base(Target)
    {
        PCHUsage = PCHUsageMode.UseExplicitOrSharedPCHs;

        PublicDependencyModuleNames.AddRange(new[]
        {
            "Core",
            "CoreUObject",
            "Engine",
            "DeveloperSettings",
            "HTTP",
            "Json",
            "JsonUtilities",
            "MediaAssets",
            "UMG",
            "WebSockets"
        });
    }
}

