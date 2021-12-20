/* * Copyright (c) 2021 Huawei Device Co., Ltd.
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

#include "assembly-type.h"
#include "assembly-program.h"
#include "assembly-emitter.h"
#include "json/json.h"
#include "ts2abc_options.h"
#include "ts2abc.h"

int main(int argc, const char *argv[])
{
    panda::PandArgParser argParser;
    panda::Span<const char *> sp(argv, argc);
    panda::ts2abc::Options options(sp[0]);
    options.AddOptions(&argParser);

    if (!argParser.Parse(argc, argv)) {
        std::cerr << argParser.GetErrorString();
        std::cerr << argParser.GetHelpString();
        return RETURN_FAILED;
    }

    std::string usage = "Usage: ts2abc [OPTIONS]... [ARGS]...";
    if (options.GetHelpArg()) {
        std::cout << usage << std::endl;
        std::cout << argParser.GetHelpString();
        return RETURN_SUCCESS;
    }

    if (options.GetBcVersionArg() || options.GetBcMinVersionArg()) {
        std::string version = options.GetBcVersionArg() ? panda::panda_file::GetVersion(panda::panda_file::version) :
                              panda::panda_file::GetVersion(panda::panda_file::minVersion);
        std::cout << version << std::endl;
        return RETURN_SUCCESS;
    }

    if ((options.GetOptLevelArg() < OptLevel::O_LEVEL0) || (options.GetOptLevelArg() > OptLevel::O_LEVEL2)) {
        std::cerr << "Incorrect optimization level value" << std::endl;
        std::cerr << usage << std::endl;
        std::cerr << argParser.GetHelpString();
        return RETURN_FAILED;
    }

    std::string input, output;
    std::string data = "";

    if (!options.GetCompileByPipeArg()) {
        input = options.GetTailArg1();
        output = options.GetTailArg2();
        if (input.empty() || output.empty()) {
            std::cerr << "Incorrect args number" << std::endl;
            std::cerr << "Usage example: ts2abc test.json test.abc"<< std::endl;
            std::cerr << usage << std::endl;
            std::cerr << argParser.GetHelpString();
            return RETURN_FAILED;
        }
        
        if (!HandleJsonFile(input, data)) {
            return RETURN_FAILED;
        }
    } else {
        output = options.GetTailArg1();
        if (output.empty()) {
            std::cerr << usage << std::endl;
            std::cerr << argParser.GetHelpString();
            return RETURN_FAILED;
        }

        if (!ReadFromPipe(data)) {
            return RETURN_FAILED;
        }
    }

    if (!GenerateProgram(data, output, options.GetOptLevelArg(), options.GetOptLogLevelArg())) {
        std::cerr << "call GenerateProgram fail" << std::endl;
        return RETURN_FAILED;
    }

    return RETURN_SUCCESS;
}
